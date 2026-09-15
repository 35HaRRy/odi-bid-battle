import { describe, expect, it } from "vitest";
import { api } from "./api";
import { t } from "./i18n";
import { emptyLiveRound, isLiveAuction } from "./live-council";

describe("live council entry", () => {
  it("has live council i18n keys in both languages", () => {
    for (const k of [
      "liveCouncilTitle",
      "liveCouncilIntro",
      "liveWaiting",
      "liveLockedNote",
      "startFailed",
    ]) {
      expect(t("tr", k)).not.toBe(k);
      expect(t("en", k)).not.toBe(k);
    }
  });

  it("exposes startAuction client", () => {
    expect(typeof api.startAuction).toBe("function");
  });

  it("calls POST /auctions/:id/start", async () => {
    const orig = globalThis.fetch;
    // @ts-expect-error stub
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/auctions/auc-1/start");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ id: "auc-1", status: "ongoing" }), {
        status: 200,
      });
    };
    try {
      const res = await api.startAuction("auc-1");
      expect(res.status).toBe("ongoing");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("treats ongoing auctions as live and opens with no active candidate", () => {
    expect(isLiveAuction("ongoing")).toBe(true);
    expect(isLiveAuction("draft")).toBe(false);
    const round = emptyLiveRound([
      { id: "t1", members: ["a", "b"] },
      { id: "t2", members: ["c"] },
    ]);
    expect(round.activeCandidateId).toBeNull();
    expect(round.acquired).toEqual([[], []]);
    expect(round.contributions).toEqual([
      [0, 0],
      [0],
    ]);
  });
});
