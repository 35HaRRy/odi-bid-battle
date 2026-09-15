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

  it("pins delete-draft copy in both languages", () => {
    expect(t("tr", "delete")).toBe("Sil");
    expect(t("en", "delete")).toBe("Delete");
    expect(t("tr", "deleted")).toBe("Taslak silindi.");
    expect(t("en", "deleted")).toBe("Draft deleted.");
  });

  it("surfaces delete failure status to the banner path", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "only drafts can be deleted" }), {
        status: 409,
      });
    try {
      await expect(api.deleteAuction("auc-live")).rejects.toMatchObject({
        status: 409,
      });
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("posts a clone request with the user-authored name", async () => {
    const orig = globalThis.fetch;
    let seen: unknown;
    // @ts-expect-error test stub intentionally narrows fetch inputs.
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      expect(url).toContain("/auctions/auc-1/clone");
      expect(init?.method).toBe("POST");
      seen = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "clone-1", name: "My copy", status: "draft" }), { status: 201 });
    };
    try {
      const clone = await api.cloneAuction("auc-1", "My copy");
      expect(seen).toEqual({ name: "My copy" });
      expect(clone.status).toBe("draft");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("has clone labels in both languages", () => {
    expect(t("tr", "cloneAuction")).not.toBe("cloneAuction");
    expect(t("en", "cloneAuction")).not.toBe("cloneAuction");
  });
});
