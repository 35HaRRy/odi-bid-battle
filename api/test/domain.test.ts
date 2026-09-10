import { describe, expect, it } from "vitest";
import {
  addEntry,
  createCandidate,
  createCandidateList,
  removeEntry,
  reorderEntry,
} from "../src/domain.js";

describe("candidate", () => {
  it("creates a candidate with name", () => {
    const c = createCandidate("Aday A");
    expect(c.name).toBe("Aday A");
    expect(c.id.length).toBeGreaterThan(0);
  });

  it("rejects blank name", () => {
    expect(() => createCandidate("  ")).toThrow(/name/i);
  });
});

describe("candidate list entries", () => {
  it("adds existing candidates in order", () => {
    const list = createCandidateList("Liste 1");
    const a = createCandidate("A");
    const b = createCandidate("B");
    addEntry(list, a.id);
    addEntry(list, b.id);
    expect(list.entries).toEqual([a.id, b.id]);
  });

  it("rejects the same candidate record twice in one list", () => {
    const list = createCandidateList("Liste 1");
    const a = createCandidate("A");
    addEntry(list, a.id);
    expect(() => addEntry(list, a.id)).toThrow(/duplicate/i);
  });

  it("removes entries", () => {
    const list = createCandidateList("L");
    addEntry(list, "c1");
    addEntry(list, "c2");
    removeEntry(list, "c1");
    expect(list.entries).toEqual(["c2"]);
  });

  it("reorders entries", () => {
    const list = createCandidateList("L");
    addEntry(list, "c1");
    addEntry(list, "c2");
    addEntry(list, "c3");
    reorderEntry(list, "c1", 2);
    expect(list.entries).toEqual(["c2", "c3", "c1"]);
  });

  it("draft lists may be incomplete (empty name allowed as draft)", () => {
    const list = createCandidateList("", { draft: true });
    expect(list.isDraft).toBe(true);
  });

  it("non-draft lists require a name", () => {
    expect(() => createCandidateList("", { draft: false })).toThrow(/name/i);
  });
});
