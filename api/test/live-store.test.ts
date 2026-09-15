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
  it("opens with no active candidate and persists across reconnects", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const { auction } = await seedLiveAuction(store);
      const live = await store.live.getLive(auction.id);
      expect(live.active).toBe(false);
      expect(live.activeCandidateId).toBeNull();
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
