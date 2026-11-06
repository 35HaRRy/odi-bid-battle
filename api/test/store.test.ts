import { describe, expect, it } from "vitest";
import { PersistenceError, PgStore } from "../src/store.js";
import { ownedStore } from "./helpers/domain.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

describe("store failure surface", () => {
  it("surfaces persistence failure as PersistenceError, not silent save", async () => {
    const failingPool = {
      query: async () => {
        throw new Error("connection refused");
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PgStore(failingPool as any).forUser("fixture-owner");
    await expect(
      store.saveCandidate("A", PNG, "image/png", "a.png"),
    ).rejects.toBeInstanceOf(PersistenceError);
  });
});

describe("pg persist/rehydrate", () => {
  it("saves candidates, lists, entries; rejects duplicates; survives re-read", async () => {
    const store = await ownedStore(DATABASE_URL);
    try {
      const c1 = await store.saveCandidate(
        "Aday 1",
        PNG,
        "image/png",
        "a1.png",
      );
      const c2 = await store.saveCandidate(
        "Aday 2",
        PNG,
        "image/png",
        "a2.png",
      );
      const list = await store.saveList("Liste 1", true);
      await store.addEntryToList(list.id, c1.id);
      await store.addEntryToList(list.id, c2.id);
      await expect(store.addEntryToList(list.id, c1.id)).rejects.toThrow(
        /duplicate/i,
      );
      const reloaded = await store.getList(list.id);
      expect(reloaded.entries).toEqual([c1.id, c2.id]);

      await store.reorderEntryInList(list.id, c1.id, 1);
      const moved = await store.getList(list.id);
      expect(moved.entries).toEqual([c2.id, c1.id]);

      // simulate app restart: fresh connection reads same rows + image bytes
      const fresh = (await PgStore.connect(DATABASE_URL)).forUser(store.userId);
      try {
        const again = await fresh.getList(list.id);
        expect(again.entries).toEqual([c2.id, c1.id]);
        const cand = await fresh.getCandidate(c1.id);
        expect(cand.image).toEqual(PNG);
      } finally {
        await fresh.close();
      }

      // archive hides from catalog but list entry retains
      await store.archiveCandidate(c1.id);
      const catalog = await store.listCandidates();
      expect(catalog.map((c) => c.id)).not.toContain(c1.id);
      const afterArchive = await store.getList(list.id);
      expect(afterArchive.entries).toContain(c1.id);
    } finally {
      await store.close();
    }
  }, 30000);
});
