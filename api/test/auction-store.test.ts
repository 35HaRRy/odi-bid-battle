import { describe, expect, it } from "vitest";
import { PersistenceError, PgStore } from "../src/store.js";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

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
