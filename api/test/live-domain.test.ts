import { describe, expect, it } from "vitest";
import {
  completeSale,
  confirmBid,
  emptyRoundState,
  isReadyToEnd,
  isTeamEligible,
  passCandidate,
  scheduledTeam,
  sendNextCandidate,
  teamCapacity,
} from "../src/live-domain.js";

describe("live bidding rounds (spec 4, 5, 6, 7.2)", () => {
  it("schedules odd positions to panel 1 and even positions to panel 2", () => {
    expect(scheduledTeam(0)).toBe(0);
    expect(scheduledTeam(1)).toBe(1);
    expect(scheduledTeam(2)).toBe(0);
    expect(scheduledTeam(4)).toBe(0);
    expect(teamCapacity(8)).toBe(4);
  });

  it("sends the next unprocessed candidate with zeroed contributions", () => {
    const s = emptyRoundState([2, 1]);
    const r = sendNextCandidate(s, ["c1", "c2", "c3", "c4"], [true, true], [2, 1]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.activeCandidateId).toBe("c1");
    expect(r.state.turn).toBe(0);
    expect(r.state.specialPass).toBe(false);
    expect(r.state.contributions).toEqual([
      [0, 0],
      [0],
    ]);
    expect(r.state.latest).toBeNull();
  });

  it("rejects a second send while the round is active", () => {
    const s = emptyRoundState([1, 1]);
    const first = sendNextCandidate(s, ["c1", "c2"], [true, true], [1, 1]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(sendNextCandidate(first.state, ["c1", "c2"], [true, true], [1, 1]).ok).toBe(false);
  });

  it("scenario 3: rejects non-increasing bids without changing turn; accepts higher affordable bid without deducting", () => {
    let s = emptyRoundState([2, 1]);
    const opened = sendNextCandidate(s, ["c1", "c2", "c3", "c4"], [true, true], [2, 1]);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    s = opened.state;

    const a5 = confirmBid(0, s, [2, 3], [10, 10], true);
    expect(a5.ok).toBe(true);
    if (!a5.ok) return;
    s = a5.state;
    expect(s.latest).toMatchObject({ team: 0, amount: 5 });
    expect(s.turn).toBe(1);

    // B's equal bid rejected, turn unchanged.
    const b5 = confirmBid(1, s, [5], [10], true);
    expect(b5.ok).toBe(false);
    // B's affordable 6 accepted.
    const b6 = confirmBid(1, s, [6], [10], true);
    expect(b6.ok).toBe(true);
    if (!b6.ok) return;
    expect(b6.state.latest).toMatchObject({ team: 1, amount: 6 });
    expect(b6.state.turn).toBe(0);
  });

  it("scenario 4: returning turn restores prior values as editable replacement total", () => {
    let s = emptyRoundState([2, 1]);
    const opened = sendNextCandidate(s, ["c1", "c2"], [true, true], [2, 1]);
    if (!opened.ok) throw new Error("open failed");
    s = opened.state;
    const a = confirmBid(0, s, [2, 3], [10, 10], true);
    if (!a.ok) throw new Error("A bid failed");
    const b = confirmBid(1, a.state, [6], [10], true);
    if (!b.ok) throw new Error("B bid failed");
    // A's fields still show 2 and 3 on return.
    expect(b.state.contributions[0]).toEqual([2, 3]);
    // Changing them to 4 and 3 is a replacement total of 7, not 12.
    const a2 = confirmBid(0, b.state, [4, 3], [10, 10], true);
    expect(a2.ok).toBe(true);
    if (!a2.ok) return;
    expect(a2.state.latest).toMatchObject({ team: 0, amount: 7 });
  });

  it("scenario 2: rejects zero contributions and over-balance contributions", () => {
    let s = emptyRoundState([1, 1]);
    const opened = sendNextCandidate(s, ["c1", "c2"], [true, true], [1, 1]);
    if (!opened.ok) throw new Error("open failed");
    s = opened.state;
    // Zero member gold cannot open, but zero contribution inside an affordable bid is fine.
    expect(confirmBid(0, s, [0], [10], true).ok).toBe(false);
    expect(confirmBid(0, s, [11], [10], true).ok).toBe(false);
    expect(confirmBid(0, s, [10], [10], true).ok).toBe(true);
  });

  it("scenario 6: transferred opening team may pass; skipped candidate never repeats", () => {
    let s = emptyRoundState([1, 1]);
    // A scheduled but has zero gold; turn transfers to B with special pass.
    const opened = sendNextCandidate(s, ["c1", "c2", "c3", "c4"], [false, true], [1, 1]);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.state.turn).toBe(1);
    expect(opened.state.specialPass).toBe(true);
    const passed = passCandidate(opened.state);
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.state.skipped).toEqual(["c1"]);
    expect(passed.state.cursor).toBe(1);
    expect(passed.state.active).toBe(false);
    // Next position schedules B regardless of who acted.
    expect(scheduledTeam(passed.state.cursor)).toBe(1);
  });

  it("scenario 7: scheduled eligible starter must bid and cannot pass", () => {
    const s = emptyRoundState([1, 1]);
    const opened = sendNextCandidate(s, ["c1", "c2"], [true, false], [1, 1]);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.state.turn).toBe(0);
    expect(opened.state.specialPass).toBe(false);
    expect(passCandidate(opened.state).ok).toBe(false);
    // Only the team whose turn it is can bid.
    expect(confirmBid(1, opened.state, [5], [10], false).ok).toBe(false);
    expect(confirmBid(0, opened.state, [5], [10], true).ok).toBe(true);
  });

  it("scenario 5: sale settles the latest confirmed bid and clears the round", () => {
    let s = emptyRoundState([2, 1]);
    const opened = sendNextCandidate(s, ["c1", "c2", "c3", "c4"], [true, true], [2, 1]);
    if (!opened.ok) throw new Error("open failed");
    s = opened.state;
    const a5 = confirmBid(0, s, [2, 3], [10, 10], true);
    if (!a5.ok) throw new Error("A bid failed");
    s = a5.state;
    // B's unconfirmed 7 is only a draft; the confirmed bid stays A's 5.
    const sold = completeSale(s);
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.sale).toMatchObject({ team: 0, amount: 5, candidateId: "c1" });
    expect(sold.sale.contributions).toEqual([2, 3]);
    expect(sold.state.active).toBe(false);
    expect(sold.state.activeCandidateId).toBeNull();
    expect(sold.state.latest).toBeNull();
    expect(sold.state.cursor).toBe(1);
    expect(sold.state.skipped).toEqual([]);
    expect(sold.state.contributions).toEqual([
      [0, 0],
      [0],
    ]);
  });

  it("rejects a sale with no active round or no confirmed bid", () => {
    expect(completeSale(emptyRoundState([1, 1])).ok).toBe(false);
    let s = emptyRoundState([1, 1]);
    const opened = sendNextCandidate(s, ["c1", "c2"], [true, true], [1, 1]);
    if (!opened.ok) throw new Error("open failed");
    expect(completeSale(opened.state).ok).toBe(false);
  });

  it("scenario 8: capacity stays fixed on skips and full teams cannot bid", () => {
    expect(teamCapacity(8)).toBe(4);
    // Skips do not reduce capacity: still 4 with 8 initial candidates.
    let s = emptyRoundState([1, 1]);
    const opened = sendNextCandidate(
      s,
      ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
      [false, true],
      [1, 1],
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    // Scheduled A is full (4/8); eligible B receives the opening and may pass.
    expect(opened.state.turn).toBe(1);
    expect(opened.state.specialPass).toBe(true);
    expect(passCandidate(opened.state).ok).toBe(true);
    expect(teamCapacity(8)).toBe(4);
    // A full team cannot bid even with gold remaining.
    s = opened.state;
    expect(
      confirmBid(0, { ...s, turn: 0, specialPass: false }, [1], [5], false).ok,
    ).toBe(false);
  });

  it("scenario 9/10/18: termination is ready only between resolved rounds", () => {
    // Scenario 9: full-capacity A with gold + gold-less B, mid-list.
    expect(
      isReadyToEnd({
        active: false,
        latest: null,
        cursor: 5,
        candidateCount: 8,
        eligible: [false, false],
      }),
    ).toBe(true);
    // Scenario 10: both budgets exhausted with unpresented candidates left.
    expect(
      isReadyToEnd({
        active: false,
        latest: null,
        cursor: 2,
        candidateCount: 4,
        eligible: [false, false],
      }),
    ).toBe(true);
    // Scenario 18: last candidate processed enables ending.
    expect(
      isReadyToEnd({
        active: false,
        latest: null,
        cursor: 4,
        candidateCount: 4,
        eligible: [true, true],
      }),
    ).toBe(true);
    // Not ready while a round is active or a confirmed bid is unsettled.
    expect(
      isReadyToEnd({
        active: true,
        latest: null,
        cursor: 4,
        candidateCount: 4,
        eligible: [true, true],
      }),
    ).toBe(false);
    expect(
      isReadyToEnd({
        active: false,
        latest: { team: 0, amount: 5, contributions: [5] },
        cursor: 4,
        candidateCount: 4,
        eligible: [true, true],
      }),
    ).toBe(false);
    // Not ready when candidates remain and a team can still buy.
    expect(
      isReadyToEnd({
        active: false,
        latest: null,
        cursor: 2,
        candidateCount: 8,
        eligible: [true, false],
      }),
    ).toBe(false);
  });

  it("refuses to open when neither team is eligible", () => {
    const s = emptyRoundState([1, 1]);
    expect(sendNextCandidate(s, ["c1"], [false, false], [1, 1]).ok).toBe(false);
    expect(isTeamEligible(0, 0, 4)).toBe(false);
    expect(isTeamEligible(5, 2, 4)).toBe(false);
    expect(isTeamEligible(5, 1, 4)).toBe(true);
  });
});
