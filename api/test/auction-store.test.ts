import { describe, expect, it } from "vitest";
import { PersistenceError, PgStore } from "../src/store.js";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082",
  "hex",
);

describe("auction store failure surface", () => {
  it("surfaces persistence failure as PersistenceError", async () => {
    const failingPool = {
      query: async () => {
        throw new Error("connection refused");
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PgStore(failingPool as any);
    await expect(store.listAuctions()).rejects.toBeInstanceOf(PersistenceError);
  });
});

describe("pg auction persist/rehydrate", () => {
  it("clones preparation into an editable draft without live auction state", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const candidates = [];
      for (let i = 0; i < 4; i++) {
        candidates.push(await store.saveCandidate(
          i === 0 ? "Archived candidate" : `Candidate ${i}`,
          PNG,
          "image/png",
          `candidate-${i}.png`,
        ));
      }
      const list = await store.saveList("Source list", false);
      for (const candidate of candidates) await store.addEntryToList(list.id, candidate.id);
      await store.archiveCandidate(candidates[0].id);
      expect((await store.listCandidates()).map((candidate) => candidate.id)).not.toContain(candidates[0].id);
      const source = await store.saveAuction("Source auction", list.id);
      const field = await store.battlefields.create(
        { name: "Field", geography: "Valley", history: "Old road" },
        { buffer: PNG, mime: "image/png", name: "field.png" },
      );
      await store.battlefields.select(source.id, field.id);
      await store.battlefields.setBackground(source.id, {
        buffer: PNG,
        mime: "image/png",
        name: "background.png",
      });
      const flag = { buffer: PNG, mime: "image/png", name: "flag.png" };
      const first = createAuctionTeam(source.id, "First", 0, { flag, slogan: "One" });
      const second = createAuctionTeam(source.id, "Second", 1, { flag, slogan: "Two" });
      addTeamMember(first, "A", 10);
      addTeamMember(second, "B", 10);
      await store.teams.saveAuctionTeams(source.id, [first, second]);
      await store.startAuction(source.id);
      await store.live.sendNext(source.id);
      await store.live.confirmBid(source.id, 0, [3]);
      await store.live.sell(source.id);

      const clone = await store.cloneAuction(source.id, "Cloned auction");

      expect(clone.id).not.toBe(source.id);
      expect(clone.name).toBe("Cloned auction");
      expect(clone.status).toBe("draft");
      expect(clone.followsSource).toBe(false);
      expect(clone.entries).toEqual(candidates.map((candidate) => candidate.id));
      expect(clone.battlefieldId).toBe(field.id);
      expect((await store.battlefields.getBackground(clone.id))?.buffer).toEqual(PNG);
      expect((await store.getAuction(source.id)).status).toBe("ongoing");
      expect((await store.getAuction(source.id)).entries).toEqual(candidates.map((candidate) => candidate.id));

      const clonedTeams = await store.teams.getAuctionTeams(clone.id);
      expect(clonedTeams.map((team) => team.name)).toEqual(["First", "Second"]);
      expect(clonedTeams.every((team) => team.auctionId === clone.id)).toBe(true);
      expect(clonedTeams[0].members[0].initialGold).toBe(10);

      await expect(store.live.getLive(clone.id)).rejects.toThrow("auction not started");
      for (const table of [
        "auction_live_state",
        "auction_live_balances",
        "auction_live_contributions",
        "auction_live_latest",
        "auction_live_skipped",
        "auction_live_acquired",
        "auction_live_history",
      ]) {
        const rows = await store.pool!.query(
          `SELECT COUNT(*)::int AS count FROM ${table} WHERE auction_id=$1`,
          [clone.id],
        );
        expect(rows.rows[0].count, table).toBe(0);
      }
    } finally {
      await store.close();
    }
  }, 30000);

  it("creates drafts from lists, follows until fork, renames independently, resumes after restart", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const c1 = await store.saveCandidate(
        "Aday A1",
        Buffer.from([1]),
        "image/png",
        "a1.png",
      );
      const c2 = await store.saveCandidate(
        "Aday A2",
        Buffer.from([2]),
        "image/png",
        "a2.png",
      );
      const c3 = await store.saveCandidate(
        "Aday A3",
        Buffer.from([3]),
        "image/png",
        "a3.png",
      );
      const list = await store.saveList("Liste K", true);
      await store.addEntryToList(list.id, c1.id);
      await store.addEntryToList(list.id, c2.id);

      const d1 = await store.saveAuction("Taslak 1", list.id);
      const d2 = await store.saveAuction("Taslak 2", list.id);
      expect(d1.followsSource).toBe(true);
      expect(d1.entries).toEqual([c1.id, c2.id]);

      // source reorder affects both followed drafts
      await store.reorderEntryInList(list.id, c1.id, 1);
      expect((await store.getAuction(d1.id)).entries).toEqual([c2.id, c1.id]);
      expect((await store.getAuction(d2.id)).entries).toEqual([c2.id, c1.id]);

      // rename alone forks d2
      const renamed = await store.renameAuction(d2.id, "Taslak 2b");
      expect(renamed.name).toBe("Taslak 2b");
      expect(renamed.followsSource).toBe(false);
      // later source edit affects only still-linked d1
      await store.addEntryToList(list.id, c3.id);
      expect((await store.getAuction(d1.id)).entries).toContain(c3.id);
      expect((await store.getAuction(d2.id)).entries).not.toContain(c3.id);
      // original list name untouched, d1 name independent
      await store.renameAuction(d1.id, "Taslak 1b");
      expect((await store.getList(list.id)).name).toBe("Liste K");

      // duplicate in forked copy rejected
      await expect(store.addEntryToAuction(d2.id, c1.id)).rejects.toThrow(
        /duplicate/i,
      );

      // restart: fresh connection reads same rows
      const fresh = await PgStore.connect(DATABASE_URL);
      try {
        const again = await fresh.getAuction(d1.id);
        expect(again.entries).toContain(c3.id);
        const all = await fresh.listAuctions();
        expect(all.map((a) => a.id)).toContain(d1.id);
      } finally {
        await fresh.close();
      }
    } finally {
      await store.close();
    }
  }, 30000);

  it("deletes drafts and refuses non-drafts", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const d = await store.saveAuction("Silinecek", null);
      await store.deleteDraftAuction(d.id);
      await expect(store.getAuction(d.id)).rejects.toThrow("auction not found");
      await expect(store.deleteDraftAuction("missing-id")).rejects.toThrow("auction not found");
    } finally {
      await store.close();
    }
  }, 30000);

  it("refuses non-draft deletes and cascades entries and teams", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const c = await store.saveCandidate(
        "Aday Sil",
        Buffer.from([9]),
        "image/png",
        "sil.png",
      );

      // Non-draft refusal: row survives, exact guard string preserved.
      const live = await store.saveAuction("Canli", null);
      await store.addEntryToAuction(live.id, c.id);
      await store.pool!.query("UPDATE auctions SET status='ongoing' WHERE id=$1", [live.id]);
      await expect(store.deleteDraftAuction(live.id)).rejects.toThrow(
        "only drafts can be deleted",
      );
      expect((await store.getAuction(live.id)).id).toBe(live.id);

      // Cascade: draft with entries + teams deletes row and children.
      const d = await store.saveAuction("Cascade", null);
      await store.addEntryToAuction(d.id, c.id);
      const flag = {
        buffer: Buffer.from([137, 80, 78, 71]),
        mime: "image/png",
        name: "flag.png",
      };
      const t1 = createAuctionTeam(d.id, "Kuzey", 0, { flag });
      const t2 = createAuctionTeam(d.id, "Guney", 1, { flag });
      addTeamMember(t1, "Elif", 10);
      addTeamMember(t2, "Deniz", 20);
      await store.teams.saveAuctionTeams(d.id, [t1, t2]);
      await store.deleteDraftAuction(d.id);
      await expect(store.getAuction(d.id)).rejects.toThrow("auction not found");
      await expect(store.teams.getAuctionTeams(d.id)).rejects.toThrow(
        "auction not found",
      );
      const left = await store.pool!.query(
        "SELECT COUNT(*)::int AS n FROM auction_entries WHERE auction_id=$1",
        [d.id],
      );
      expect((left.rows[0] as { n: number }).n).toBe(0);
    } finally {
      await store.close();
    }
  }, 30000);
});
