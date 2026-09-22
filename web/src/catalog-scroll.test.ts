import { describe, expect, it } from "vitest";
import {
  applyCatalogCreate,
  applyCatalogEdit,
  searchForVisibleRecord,
} from "./catalog-scroll";
import type { Candidate } from "./api";

function cand(id: string, name: string): Candidate {
  return { id, name } as Candidate;
}

describe("catalog scroll after new record", () => {
  it("edit with same id keeps order and requests no scroll", () => {
    const items = [cand("a", "Ali"), cand("b", "Veli")];
    const r = applyCatalogEdit(items, "a", cand("a", "Ali Yeni"));
    expect(r.items.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.items[0].name).toBe("Ali Yeni");
    expect(r.scrollId).toBeNull();
  });

  it("edit with new id (auction copy) moves to end and requests scroll", () => {
    const items = [cand("a", "Ali"), cand("b", "Veli")];
    const r = applyCatalogEdit(items, "a", cand("c", "Ali Yeni"));
    expect(r.items.map((c) => c.id)).toEqual(["b", "c"]);
    expect(r.scrollId).toBe("c");
  });

  it("create appends and requests scroll", () => {
    const items = [cand("a", "Ali")];
    const r = applyCatalogCreate(items, cand("b", "Veli"));
    expect(r.items.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.scrollId).toBe("b");
  });

  it("clears search when new record would be filtered out", () => {
    expect(searchForVisibleRecord("vel", "Ali Yeni", "tr")).toBe("");
  });

  it("keeps search when new record still matches", () => {
    expect(searchForVisibleRecord("ali", "Ali Yeni", "tr")).toBe("ali");
  });
});
