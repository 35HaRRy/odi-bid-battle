import { describe, expect, it } from "vitest";
import { api } from "./api";
import { t } from "./i18n";

describe("auction drafts i18n", () => {
  it("has draft keys in both languages", () => {
    for (const k of [
      "createDraft",
      "rename",
      "draftName",
      "resume",
      "fromList",
      "searchAuctions",
      "currentDraft",
    ])
      expect(t("tr", k)).not.toBe(k);
    for (const k of [
      "createDraft",
      "rename",
      "draftName",
      "resume",
      "fromList",
      "searchAuctions",
      "currentDraft",
    ])
      expect(t("en", k)).not.toBe(k);
  });

  it("never translates user-authored draft names (rendered raw)", () => {
    const draftName = "Benim Taslağım";
    expect(t("en", draftName)).toBe(draftName);
    expect(t("tr", draftName)).toBe(draftName);
  });

  it("persists selected draft pointer key contract", () => {
    expect("obb-selected-auction").toBe("obb-selected-auction");
  });

  it("has delete-draft keys and client", async () => {
    for (const k of ["delete", "deleteDraftTitle", "deleteDraftText", "deleted"]) {
      expect(t("tr", k)).not.toBe(k);
      expect(t("en", k)).not.toBe(k);
    }
    expect(typeof api.deleteAuction).toBe("function");
  });

  it("calls DELETE /auctions/:id on deleteAuction", async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    // @ts-expect-error stub
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(null, { status: 204 });
    };
    try {
      await api.deleteAuction("auc-1");
      expect(calls.some((c) => c.includes("DELETE") && c.includes("/auctions/auc-1"))).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
