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
      "sendNext",
      "confirmBid",
      "contribution",
      "remaining",
      "turnHere",
      "waitingTurn",
      "latestBid",
      "noBid",
      "activeCandidate",
      "draftBid",
      "confirmedBid",
      "acquired",
      "noneAcquired",
      "pass",
      "passHint",
      "awaitCandidate",
      "awaitHint",
      "bidError",
      "contributionError",
      "notYourTurn",
      "cannotBid",
      "noActiveRound",
      "noGold",
      "fullCapacity",
      "finishSale",
      "saleTitle",
      "saleExplain",
      "confirmSale",
      "saleDone",
      "saleError",
      "processed",
      "skipped",
      "endedTitle",
      "readyEnd",
      "noRemaining",
      "noEligible",
      "endAuction",
      "endTitle",
      "endExplain",
      "battleBegin",
      "resolveFirst",
      "settleFirst",
      "endNotReady",
      "auctionEnded",
      "passError",
      "undo",
      "battleInfo",
      "fullscreen",
      "firstHalf",
      "secondHalf",
      "undoDone",
      "nothingToUndo",
    ]) {
      expect(t("tr", k)).not.toBe(k);
      expect(t("en", k)).not.toBe(k);
    }
  });

  it("exposes startAuction client", () => {
    expect(typeof api.startAuction).toBe("function");
  });

  it("exposes live round clients", () => {
    expect(typeof api.getLive).toBe("function");
    expect(typeof api.sendNextCandidate).toBe("function");
    expect(typeof api.confirmBid).toBe("function");
    expect(typeof api.passCandidate).toBe("function");
    expect(typeof api.completeSale).toBe("function");
    expect(typeof api.endAuction).toBe("function");
    expect(typeof api.undoLiveAction).toBe("function");
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

  it("calls GET /auctions/:id/live", async () => {
    const orig = globalThis.fetch;
    // @ts-expect-error stub
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/auctions/auc-1/live");
      expect(init?.method ?? "GET").not.toBe("POST");
      return new Response(
        JSON.stringify({
          auctionId: "auc-1",
          active: false,
          activeCandidateId: null,
          turn: 0,
          contributions: [[0], [0]],
          teams: [],
        }),
        { status: 200 },
      );
    };
    try {
      const res = await api.getLive("auc-1");
      expect(res.active).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("posts bids with team and contributions", async () => {
    const orig = globalThis.fetch;
    let seen: unknown = null;
    // @ts-expect-error stub
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/auctions/auc-1/live/bids");
      expect(init?.method).toBe("POST");
      seen = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ latest: { team: 0, amount: 5 } }),
        { status: 200 },
      );
    };
    try {
      const res = await api.confirmBid("auc-1", 0, [2, 3]);
      expect(seen).toMatchObject({ team: 0, contributions: [2, 3] });
      expect(res.latest).toMatchObject({ team: 0, amount: 5 });
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("posts termination to /auctions/:id/live/end", async () => {
    const orig = globalThis.fetch;
    // @ts-expect-error stub
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/auctions/auc-1/live/end");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ status: "completed", cursor: 4 }), {
        status: 200,
      });
    };
    try {
      const res = await api.endAuction("auc-1");
      expect(res.status).toBe("completed");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("posts sales to /auctions/:id/live/sale", async () => {
    const orig = globalThis.fetch;
    // @ts-expect-error stub
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/auctions/auc-1/live/sale");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ active: false, cursor: 1 }), { status: 200 });
    };
    try {
      const res = await api.completeSale("auc-1");
      expect(res.active).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("posts undo to /auctions/:id/live/undo", async () => {
    const orig = globalThis.fetch;
    // @ts-expect-error stub
    globalThis.fetch = async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/auctions/auc-1/live/undo");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ active: true, cursor: 0, canUndo: false }), {
        status: 200,
      });
    };
    try {
      const res = await api.undoLiveAction("auc-1");
      expect(res.active).toBe(true);
      expect(res.canUndo).toBe(false);
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
