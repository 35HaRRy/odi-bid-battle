import { describe, expect, it } from "vitest";
import { PersistenceError, PgStore } from "../src/store.js";

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
});
