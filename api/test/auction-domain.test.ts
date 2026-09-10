import { describe, expect, it } from "vitest";
import {
  addEntryToDraft,
  createAuctionDraft,
  removeEntryFromDraft,
  renameDraft,
  reorderEntryInDraft,
  syncFollowedDraft,
} from "../src/domain.js";

describe("auction draft", () => {
  it("creates a draft following the source list entries", () => {
    const d = createAuctionDraft("Taslak 1", ["c1", "c2"], "list-1");
    expect(d.name).toBe("Taslak 1");
    expect(d.followsSource).toBe(true);
    expect(d.entries).toEqual(["c1", "c2"]);
    expect(d.sourceListId).toBe("list-1");
  });

  it("rename alone forks the draft (independent copy)", () => {
    const d = createAuctionDraft("A", ["c1"], "list-1");
    renameDraft(d, "B");
    expect(d.name).toBe("B");
    expect(d.followsSource).toBe(false);
  });

  it("followed drafts mirror source reorder; forked drafts do not", () => {
    const a = createAuctionDraft("A", ["c1", "c2"], "list-1");
    const b = createAuctionDraft("B", ["c1", "c2"], "list-1");
    renameDraft(b, "B2"); // fork b
    syncFollowedDraft(a, ["c2", "c1"]);
    syncFollowedDraft(b, ["c2", "c1"]);
    expect(a.entries).toEqual(["c2", "c1"]);
    expect(b.entries).toEqual(["c1", "c2"]);
  });

  it("local list edits fork before applying", () => {
    const d = createAuctionDraft("A", ["c1"], "list-1");
    addEntryToDraft(d, "c2");
    expect(d.followsSource).toBe(false);
    expect(d.entries).toEqual(["c1", "c2"]);
    expect(() => addEntryToDraft(d, "c2")).toThrow(/duplicate/i);
    removeEntryFromDraft(d, "c1");
    expect(d.entries).toEqual(["c2"]);
  });

  it("reorders draft entries", () => {
    const d = createAuctionDraft("A", ["c1", "c2", "c3"], null);
    reorderEntryInDraft(d, "c1", 2);
    expect(d.entries).toEqual(["c2", "c3", "c1"]);
  });

  it("draft with missing battlefield/team is still saveable", () => {
    const d = createAuctionDraft("", [], null);
    expect(d.battlefieldId).toBeNull();
    expect(d.name).toBe("");
  });
});
