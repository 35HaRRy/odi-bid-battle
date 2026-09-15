import { describe, expect, it } from "vitest";
import { PgStore } from "../src/store.js";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082",
  "hex",
);

async function seedLiveAuctionWithGold(
  store: PgStore,
  goldA: number,
  goldB: number,
  candidateCount = 4,
) {
  const ids: string[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const c = await store.saveCandidate(`Aday ${i}`, PNG, "image/png", `a${i}.png`);
    ids.push(c.id);
  }
  const list = await store.saveList("Liste", false);
  for (const id of ids) await store.addEntryToList(list.id, id);
  const auction = await store.saveAuction("Divan", list.id);
  const field = await store.battlefields.create(
    { name: "Alan", geography: "Vadi", history: "Tarih" },
    { buffer: PNG, mime: "image/png", name: "b.png" },
  );
  await store.battlefields.select(auction.id, field.id);
  const flag = { buffer: PNG, mime: "image/png", name: "flag.png" };
  const t1 = createAuctionTeam(auction.id, "Kuzey", 0, { flag, slogan: "Birlik" });
  const t2 = createAuctionTeam(auction.id, "Guney", 1, { flag, slogan: "Guc" });
  addTeamMember(t1, "Elif", goldA);
  addTeamMember(t2, "Deniz", goldB);
  await store.teams.saveAuctionTeams(auction.id, [t1, t2]);
  await store.startAuction(auction.id);
  return { auction, ids };
}

async function seedLiveAuction(store: PgStore) {
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const c = await store.saveCandidate(`Aday ${i}`, PNG, "image/png", `a${i}.png`);
    ids.push(c.id);
  }
  const list = await store.saveList("Liste", false);
  for (const id of ids) await store.addEntryToList(list.id, id);
  const auction = await store.saveAuction("Divan", list.id);
  const field = await store.battlefields.create(
    { name: "Alan", geography: "Vadi", history: "Tarih" },
    { buffer: PNG, mime: "image/png", name: "b.png" },
  );
  await store.battlefields.select(auction.id, field.id);
  const flag = { buffer: PNG, mime: "image/png", name: "flag.png" };
  const t1 = createAuctionTeam(auction.id, "Kuzey", 0, { flag, slogan: "Birlik" });
  const t2 = createAuctionTeam(auction.id, "Guney", 1, { flag, slogan: "Guc" });
  addTeamMember(t1, "Elif", 10);
  addTeamMember(t1, "Kaya", 10);
  addTeamMember(t2, "Deniz", 20);
  await store.teams.saveAuctionTeams(auction.id, [t1, t2]);
  await store.startAuction(auction.id);
  return { auction, ids };
}

describe("live round store", () => {
  it("undo restores halfway skip, transferred opening drafts, and permanent preparation lock", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction, ids } = await seedLiveAuctionWithGold(store, 20, 20, 8);
      for (const [team, amount] of [[0, 1], [1, 20], [0, 1]] as const) {
        await store.live.sendNext(auction.id);
        await store.live.confirmBid(auction.id, team, [amount]);
        await store.live.sell(auction.id);
      }
      await store.live.sendNext(auction.id);
      const passed = await store.live.pass(auction.id, [[4], [0]]);
      expect(passed.cursor).toBe(4);
      expect(passed.skipped).toEqual([ids[3]]);
      const restored = await store.live.undo(auction.id);
      expect(restored.cursor).toBe(3);
      expect(restored.activeCandidateId).toBe(ids[3]);
      expect(restored.specialPass).toBe(true);
      expect(restored.turn).toBe(0);
      expect(restored.contributions).toEqual([[4], [0]]);
      expect(restored.skipped).toEqual([]);
      expect(restored.capacity).toBe(4);
      let state = restored;
      while (state.canUndo) state = await store.live.undo(auction.id);
      expect(state.active).toBe(false);
      expect(state.cursor).toBe(0);
      expect(state.status).toBe("ongoing");
      expect(state.teams.map((team) => team.remainingGold)).toEqual([20, 20]);
      await expect(store.renameAuction(auction.id, "Changed")).rejects.toThrow("preparation locked");
      await expect(store.live.undo(auction.id)).rejects.toThrow("nothing to undo");
      expect(await store.live.getLive(auction.id)).toEqual(state);
    } finally { await store.close(); }
  });

  it("undo termination restores only ready-to-end state across reconnects", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction } = await seedLiveAuctionWithGold(store, 1, 1);
      for (const team of [0, 1] as const) {
        await store.live.sendNext(auction.id);
        await store.live.confirmBid(auction.id, team, [1]);
        await store.live.sell(auction.id);
      }
      const before = await store.live.getLive(auction.id);
      await store.live.endAuction(auction.id);
      const fresh = await PgStore.connect(DATABASE_URL);
      try { expect(await fresh.live.undo(auction.id)).toEqual(before); }
      finally { await fresh.close(); }
      expect((await store.getAuction(auction.id)).status).toBe("ongoing");
    } finally { await store.close(); }
  });
  it("undo restores sale drafts and exact refunds only after undoing later presentation", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction, ids } = await seedLiveAuction(store);
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 0, [2, 3]);
      await store.live.sell(auction.id, [[2, 3], [7]]);
      await store.live.sendNext(auction.id);
      const between = await store.live.undo(auction.id);
      expect(between.active).toBe(false);
      expect(between.teams[0].members.map((m) => m.balance)).toEqual([8, 7]);
      const restored = await store.live.undo(auction.id);
      expect(restored.activeCandidateId).toBe(ids[0]);
      expect(restored.latest).toEqual({ team: 0, amount: 5, contributions: [2, 3] });
      expect(restored.contributions).toEqual([[2, 3], [7]]);
      expect(restored.turn).toBe(1);
      expect(restored.cursor).toBe(0);
      expect(restored.teams[0].members.map((m) => m.balance)).toEqual([10, 10]);
      expect(restored.teams[1].remainingGold).toBe(20);
      expect(restored.teams[0].acquired).toEqual([]);
      const fresh = await PgStore.connect(DATABASE_URL);
      try {
        expect(await fresh.live.getLive(auction.id)).toEqual(restored);
      } finally { await fresh.close(); }
    } finally { await store.close(); }
  });
  it("opens with no active candidate and persists across reconnects", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction } = await seedLiveAuction(store);
      const live = await store.live.getLive(auction.id);
      expect(live.active).toBe(false);
      expect(live.activeCandidateId).toBeNull();
      expect(live.battlefield).toMatchObject({
        name: "Alan",
        geography: "Vadi",
        history: "Tarih",
      });
      expect(live.battlefieldVisible).toBe(false);
      expect(live.contributions).toEqual([
        [0, 0],
        [0],
      ]);
      const fresh = await PgStore.connect(DATABASE_URL);
      try {
        expect((await fresh.live.getLive(auction.id)).active).toBe(false);
      } finally {
        await fresh.close();
      }
    } finally {
      await store.close();
    }
  }, 30000);

  it("switches the battlefield after halfway processing and restores it on undo", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction } = await seedLiveAuctionWithGold(store, 20, 20, 4);
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 0, [1]);
      const halfway = await store.live.sell(auction.id);
      expect(halfway.cursor).toBe(1);
      expect(halfway.battlefieldVisible).toBe(false);

      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 1, [1]);
      const transitioned = await store.live.sell(auction.id);
      expect(transitioned.cursor).toBe(2);
      expect(transitioned.battlefieldVisible).toBe(true);

      await store.live.sendNext(auction.id);
      const restored = await store.live.undo(auction.id);
      expect(restored.cursor).toBe(2);
      expect(restored.active).toBe(false);
      expect(restored.battlefieldVisible).toBe(true);
      const initialScene = await store.live.undo(auction.id);
      expect(initialScene.cursor).toBe(1);
      expect(initialScene.active).toBe(true);
      expect(initialScene.battlefieldVisible).toBe(false);
    } finally { await store.close(); }
  }, 30000);

  it("counts an allowed skip at halfway and undo restores the initial scene", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction } = await seedLiveAuctionWithGold(store, 2, 2, 4);
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 0, [1]);
      await store.live.confirmBid(auction.id, 1, [2]);
      const sold = await store.live.sell(auction.id);
      expect(sold.cursor).toBe(1);
      expect(sold.battlefieldVisible).toBe(false);

      await store.live.sendNext(auction.id);
      const transitioned = await store.live.pass(auction.id);
      expect(transitioned.cursor).toBe(2);
      expect(transitioned.battlefieldVisible).toBe(true);

      const restored = await store.live.undo(auction.id);
      expect(restored.cursor).toBe(1);
      expect(restored.battlefieldVisible).toBe(false);
      expect(restored.active).toBe(true);
    } finally { await store.close(); }
  }, 30000);

  it("sends next candidate in fixed order and confirms strictly increasing bids without deducting gold", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction, ids } = await seedLiveAuction(store);
      const opened = await store.live.sendNext(auction.id);
      expect(opened.activeCandidateId).toBe(ids[0]);
      expect(opened.turn).toBe(0);
      expect(opened.specialPass).toBe(false);

      const a5 = await store.live.confirmBid(auction.id, 0, [2, 3]);
      expect(a5.latest).toMatchObject({ team: 0, amount: 5 });
      expect(a5.turn).toBe(1);
      // No gold deducted by confirming.
      expect(a5.teams[0].remainingGold).toBe(20);
      expect(a5.teams[1].remainingGold).toBe(20);

      await expect(store.live.confirmBid(auction.id, 1, [5])).rejects.toThrow(
        "bid must exceed latest bid",
      );
      // Failed bid leaves confirmed bid and turn unchanged.
      const again = await store.live.getLive(auction.id);
      expect(again.latest).toMatchObject({ team: 0, amount: 5 });
      expect(again.turn).toBe(1);

      const b6 = await store.live.confirmBid(auction.id, 1, [6]);
      expect(b6.latest).toMatchObject({ team: 1, amount: 6 });
      // Returning turn restores A's prior values as replacement total.
      expect(b6.contributions[0]).toEqual([2, 3]);
      const a7 = await store.live.confirmBid(auction.id, 0, [4, 3]);
      expect(a7.latest).toMatchObject({ team: 0, amount: 7 });
    } finally {
      await store.close();
    }
  }, 30000);

  it("scenario 5: settles the latest confirmed bid, deducts only the winner, and clears the round", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction, ids } = await seedLiveAuction(store);
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 0, [2, 3]);

      const sold = await store.live.sell(auction.id);
      expect(sold.active).toBe(false);
      expect(sold.activeCandidateId).toBeNull();
      expect(sold.latest).toBeNull();
      expect(sold.cursor).toBe(1);
      // No next candidate presented automatically.
      expect(sold.contributions).toEqual([
        [0, 0],
        [0],
      ]);
      // Only the winner's confirmed contributions are deducted.
      expect(sold.teams[0].members.map((m) => m.balance)).toEqual([8, 7]);
      expect(sold.teams[0].remainingGold).toBe(15);
      expect(sold.teams[1].members.map((m) => m.balance)).toEqual([20]);
      expect(sold.teams[1].remainingGold).toBe(20);
      // Acquired candidate appears with name and price.
      expect(sold.teams[0].acquired).toMatchObject([{ price: 5 }]);
      expect(sold.teams[0].acquired[0].candidateId).toBe(ids[0]);
      expect(sold.teams[0].acquired[0].name.length).toBeGreaterThan(0);
      expect(sold.teams[1].acquired).toEqual([]);
      // Scenario 11: the next sale can fill the winner's last free
      // capacity slot even though the loser cannot respond.
      const second = await store.live.sendNext(auction.id);
      expect(second.activeCandidateId).toBe(ids[1]);
      await store.live.confirmBid(auction.id, 1, [6]);
      await store.live.confirmBid(auction.id, 0, [4, 3]);
      const filled = await store.live.sell(auction.id);
      expect(filled.teams[0].acquiredCount).toBe(2);
      expect(filled.teams[0].acquired.map((a) => a.price)).toEqual([5, 7]);
      expect(filled.teams[0].members.map((m) => m.balance)).toEqual([4, 4]);
      expect(filled.teams[1].members.map((m) => m.balance)).toEqual([20]);
      // Settling twice is rejected; the round is gone.
      await expect(store.live.sell(auction.id)).rejects.toThrow("no active round");
      // Persists across reconnects.
      const fresh = await PgStore.connect(DATABASE_URL);
      try {
        const again = await fresh.live.getLive(auction.id);
        expect(again.teams[0].members.map((m) => m.balance)).toEqual([4, 4]);
        expect(again.teams[0].acquired).toMatchObject([{ price: 5 }, { price: 7 }]);
      } finally {
        await fresh.close();
      }
    } finally {
      await store.close();
    }
  }, 30000);

  it("rejects a sale with no confirmed bid", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction } = await seedLiveAuction(store);
      await expect(store.live.sell(auction.id)).rejects.toThrow("no active round");
      await store.live.sendNext(auction.id);
      await expect(store.live.sell(auction.id)).rejects.toThrow("no confirmed bid");
    } finally {
      await store.close();
    }
  }, 30000);

  it("scenario 10+18: ends explicitly only between resolved rounds; unpresented stay unassigned", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction, ids } = await seedLiveAuctionWithGold(store, 1, 1);
      // Fresh auction is not ready to end.
      await expect(store.live.endAuction(auction.id)).rejects.toThrow("termination not ready");
      // Active round must resolve first.
      await store.live.sendNext(auction.id);
      await expect(store.live.endAuction(auction.id)).rejects.toThrow(
        "active round must resolve",
      );
      // A buys candidate 1 for 1 gold.
      await store.live.confirmBid(auction.id, 0, [1]);
      await store.live.sell(auction.id);
      // B buys candidate 2 for 1 gold; both budgets exhausted.
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 1, [1]);
      await store.live.sell(auction.id);
      // Remaining candidates cannot be presented.
      await expect(store.live.sendNext(auction.id)).rejects.toThrow("no eligible team");
      const ready = await store.live.getLive(auction.id);
      expect(ready.readyToEnd).toBe(true);
      expect(ready.cursor).toBe(2);
      const ended = await store.live.endAuction(auction.id);
      expect(ended.status).toBe("completed");
      // Unpresented candidates remain unassigned, not skipped.
      expect(ended.skipped).toEqual([]);
      expect(ended.cursor).toBe(2);
      expect(ids.length).toBe(4);
      // Completed auctions stay readable but reject further progression.
      const reopened = await store.live.getLive(auction.id);
      expect(reopened.status).toBe("completed");
      await expect(store.live.sendNext(auction.id)).rejects.toThrow("auction completed");
      await expect(store.live.endAuction(auction.id)).rejects.toThrow("auction completed");
    } finally {
      await store.close();
    }
  }, 30000);

  it("scenario 8: full team cannot bid; scheduled full team transfers the opening with a pass", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction } = await seedLiveAuctionWithGold(store, 20, 20, 8);
      // A wins the first four candidates: unanswered when scheduled,
      // outbidding B otherwise.
      for (let i = 0; i < 4; i++) {
        const round = await store.live.sendNext(auction.id);
        if (round.turn === 0) {
          await store.live.confirmBid(auction.id, 0, [1]);
        } else {
          await store.live.confirmBid(auction.id, 1, [1]);
          await store.live.confirmBid(auction.id, 0, [2]);
        }
        const sold = await store.live.sell(auction.id);
        expect(sold.teams[0].acquiredCount).toBe(i + 1);
      }
      let live = await store.live.getLive(auction.id);
      expect(live.capacity).toBe(4);
      expect(live.teams[0].acquiredCount).toBe(4);
      // Cursor 4 schedules A, but A is full: the opening transfers to B.
      const opened = await store.live.sendNext(auction.id);
      expect(opened.turn).toBe(1);
      expect(opened.specialPass).toBe(true);
      // B passes; the candidate stays unassigned and is never repeated.
      const skipped = opened.activeCandidateId;
      const passed = await store.live.pass(auction.id);
      expect(passed.skipped).toEqual([skipped]);
      expect(passed.cursor).toBe(5);
      expect(passed.capacity).toBe(4);
      // B opens the next round, then A cannot respond at full capacity.
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 1, [1]);
      await expect(store.live.confirmBid(auction.id, 0, [1])).rejects.toThrow(
        "team cannot bid",
      );
      live = await store.live.getLive(auction.id);
      expect(live.capacity).toBe(4);
    } finally {
      await store.close();
    }
  }, 30000);

  it("rejects live actions on drafts and missing auctions", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const draft = await store.saveAuction("Taslak", null);
      await expect(store.live.getLive(draft.id)).rejects.toThrow("auction not started");
      await expect(store.live.sendNext(draft.id)).rejects.toThrow("auction not started");
      await expect(store.live.getLive("missing")).rejects.toThrow("auction not found");
    } finally {
      await store.close();
    }
  }, 30000);
});
