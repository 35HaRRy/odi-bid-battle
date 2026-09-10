import { describe, expect, it } from "vitest";
import { PgStore } from "../src/store.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

async function saveSample(store: PgStore, name: string, byte: number) {
  return store.saveCandidate(
    name,
    Buffer.from([byte, byte + 1]),
    "image/png",
    `${name}.png`,
  );
}

describe("candidate identity on edit", () => {
  it("edits an unreferenced catalog candidate in place", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const c = await saveSample(store, "Yalin Aday", 11);
      const updated = await store.editCatalogCandidate(c.id, "Yalin Aday v2", null);
      expect(updated.id).toBe(c.id);
      expect(updated.name).toBe("Yalin Aday v2");
      expect((await store.listCandidates()).map((x) => x.id)).toContain(c.id);
    } finally {
      await store.close();
    }
  });

  it("copies a referenced candidate, archives the original, keeps old lists on the original", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const a = await saveSample(store, "Katalog A", 21);
      const list = await store.saveList("Liste Ref", true);
      await store.addEntryToList(list.id, a.id);

      const b = await store.editCatalogCandidate(a.id, "Katalog A v2", null);

      expect(b.id).not.toBe(a.id);
      expect(b.name).toBe("Katalog A v2");
      // image bytes copied when no new image supplied
      const bFull = await store.getCandidate(b.id);
      expect(Buffer.from(bFull.image).length).toBe(2);
      // original archived: hidden from catalog, still resolvable + list keeps original
      expect((await store.listCandidates()).map((x) => x.id)).not.toContain(a.id);
      expect((await store.getCandidate(a.id)).archivedAt).not.toBeNull();
      expect((await store.getList(list.id)).entries).toEqual([a.id]);
      // new record offered for selection
      expect((await store.listCandidates()).map((x) => x.id)).toContain(b.id);
    } finally {
      await store.close();
    }
  });

  it("editing a list entry always creates a new record used only in that list", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const a = await saveSample(store, "Liste Aday", 31);
      const l1 = await store.saveList("Liste Bir", true);
      const l2 = await store.saveList("Liste Iki", true);
      await store.addEntryToList(l1.id, a.id);
      await store.addEntryToList(l2.id, a.id);

      const b = await store.editListEntryCandidate(l1.id, a.id, "Liste Aday v2", null);

      expect(b.id).not.toBe(a.id);
      expect((await store.getList(l1.id)).entries).toEqual([b.id]);
      expect((await store.getList(l2.id)).entries).toEqual([a.id]);
    } finally {
      await store.close();
    }
  });

  it("editing a draft entry forks the draft and uses the new record there", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const a = await saveSample(store, "Taslak Aday", 41);
      const list = await store.saveList("Kaynak Liste", true);
      await store.addEntryToList(list.id, a.id);
      const d1 = await store.saveAuction("Taslak X", list.id);
      const d2 = await store.saveAuction("Taslak Y", list.id);
      expect(d1.followsSource).toBe(true);

      const b = await store.editDraftEntryCandidate(d1.id, a.id, "Taslak Aday v2", null);

      const after = await store.getAuction(d1.id);
      expect(after.followsSource).toBe(false);
      expect(after.entries).toEqual([b.id]);
      // copy survives even though it is a single-entry swap; sibling still follows
      expect((await store.getAuction(d2.id)).entries).toEqual([a.id]);
      expect((await store.getList(list.id)).entries).toEqual([a.id]);
    } finally {
      await store.close();
    }
  });

  it("archiving a list hides it from selection but keeps auctions created from it", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const a = await saveSample(store, "Arsiv Aday", 51);
      const list = await store.saveList("Arsiv Liste", true);
      await store.addEntryToList(list.id, a.id);
      const d = await store.saveAuction("Taslak Z", list.id);

      await store.archiveList(list.id);

      expect((await store.listLists()).map((l) => l.id)).not.toContain(list.id);
      expect((await store.getList(list.id)).entries).toEqual([a.id]);
      expect((await store.getAuction(d.id)).entries).toContain(a.id);
    } finally {
      await store.close();
    }
  });

  it("resolves archived candidates by id for existing references", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const a = await saveSample(store, "Eski Aday", 61);
      const list = await store.saveList("Eski Liste", true);
      await store.addEntryToList(list.id, a.id);
      await store.archiveCandidate(a.id);
      const resolved = await store.getCandidate(a.id);
      expect(resolved.name).toBe("Eski Aday");
      expect((await store.getList(list.id)).entries).toContain(a.id);
    } finally {
      await store.close();
    }
  });
});
