// Pure bidding-round rules for issues #8-#10 (spec sections 4, 5, 6, 7.2).
// No I/O here so scenarios 2, 3, 4, 6, 7 can be tested with fixtures,
// including depleted balances that only arise after settled sales (#9).

export interface LiveMemberBalance {
  id: string;
  teamPosition: 0 | 1;
  balance: number;
}

export interface LiveLatestBid {
  team: 0 | 1;
  amount: number;
  contributions: number[];
}

export interface LiveRoundState {
  cursor: number;
  active: boolean;
  activeCandidateId: string | null;
  turn: 0 | 1;
  specialPass: boolean;
  latest: LiveLatestBid | null;
  /** Draft contribution values per team per member index. */
  contributions: number[][];
  skipped: string[];
}

export function emptyRoundState(memberCounts: [number, number]): LiveRoundState {
  return {
    cursor: 0,
    active: false,
    activeCandidateId: null,
    turn: 0,
    specialPass: false,
    latest: null,
    contributions: [
      Array.from({ length: memberCounts[0] }, () => 0),
      Array.from({ length: memberCounts[1] }, () => 0),
    ],
    skipped: [],
  };
}

/** Odd list positions (1-based) schedule panel 1; even positions panel 2. */
export function scheduledTeam(cursor: number): 0 | 1 {
  return cursor % 2 === 0 ? 0 : 1;
}

export function teamCapacity(candidateCount: number): number {
  return Math.floor(candidateCount / 2);
}

export function isTeamEligible(
  teamGold: number,
  acquiredCount: number,
  candidateCount: number,
): boolean {
  return teamGold > 0 && acquiredCount < teamCapacity(candidateCount);
}

export type SendResult =
  | { ok: true; state: LiveRoundState }
  | { ok: false; error: string };

/**
 * Open the next round. `eligible` carries per-team eligibility already
 * resolved from balances + capacity so the store layer owns data access.
 */
export function sendNextCandidate(
  state: LiveRoundState,
  entries: string[],
  eligible: [boolean, boolean],
  memberCounts: [number, number],
): SendResult {
  if (state.active) return { ok: false, error: "round already active" };
  if (state.cursor >= entries.length)
    return { ok: false, error: "no remaining candidates" };
  if (!eligible[0] && !eligible[1])
    return { ok: false, error: "no eligible team" };
  const scheduled = scheduledTeam(state.cursor);
  const turn = eligible[scheduled] ? scheduled : ((1 - scheduled) as 0 | 1);
  return {
    ok: true,
    state: {
      cursor: state.cursor,
      active: true,
      activeCandidateId: entries[state.cursor],
      turn,
      specialPass: turn !== scheduled,
      latest: null,
      contributions: [
        Array.from({ length: memberCounts[0] }, () => 0),
        Array.from({ length: memberCounts[1] }, () => 0),
      ],
      skipped: [...state.skipped],
    },
  };
}

export type BidValidation =
  | { ok: true; amount: number }
  | { ok: false; error: string };

export function validateBid(
  team: 0 | 1,
  state: LiveRoundState,
  contributions: number[],
  balances: number[],
  teamEligible: boolean,
): BidValidation {
  if (!state.active) return { ok: false, error: "no active round" };
  if (state.turn !== team) return { ok: false, error: "not your turn" };
  if (!teamEligible) return { ok: false, error: "team cannot bid" };
  if (contributions.length !== balances.length)
    return { ok: false, error: "invalid contributions" };
  for (let i = 0; i < contributions.length; i++) {
    const v = contributions[i];
    if (!Number.isInteger(v) || v < 0 || v > balances[i])
      return { ok: false, error: "invalid contribution" };
  }
  const amount = contributions.reduce((a, b) => a + b, 0);
  if (amount <= 0) return { ok: false, error: "bid must be positive" };
  if (state.latest && amount <= state.latest.amount)
    return { ok: false, error: "bid must exceed latest bid" };
  return { ok: true, amount };
}

export type ConfirmResult =
  | { ok: true; state: LiveRoundState }
  | { ok: false; error: string };

/**
 * Confirm a bid. Contributions are a replacement total for this candidate,
 * not an additional charge: the bidding team's draft values are replaced by
 * the confirmed values and preserved for the next return of the turn.
 * No gold is deducted here; only a confirmed sale (#9) deducts.
 */
export function confirmBid(
  team: 0 | 1,
  state: LiveRoundState,
  contributions: number[],
  balances: number[],
  teamEligible: boolean,
): ConfirmResult {
  const v = validateBid(team, state, contributions, balances, teamEligible);
  if (!v.ok) return v;
  const next: LiveRoundState = {
    ...state,
    contributions: state.contributions.map((row, i) =>
      i === team ? [...contributions] : [...row],
    ),
    latest: { team, amount: v.amount, contributions: [...contributions] },
    turn: (1 - team) as 0 | 1,
    specialPass: false,
  };
  return { ok: true, state: next };
}

export interface LiveSale {
  team: 0 | 1;
  amount: number;
  contributions: number[];
  candidateId: string;
}

export type SaleResult =
  | { ok: true; state: LiveRoundState; sale: LiveSale }
  | { ok: false; error: string };

/**
 * Settle the active round to the latest confirmed bid (spec 6.4).
 * Uses the confirmed bid only; unconfirmed drafts never affect the sale.
 * Clears round contributions/bids, closes the round, and advances the cursor
 * without presenting the next candidate.
 */
export function completeSale(state: LiveRoundState): SaleResult {
  if (!state.active) return { ok: false, error: "no active round" };
  if (!state.activeCandidateId)
    return { ok: false, error: "no active candidate" };
  if (!state.latest) return { ok: false, error: "no confirmed bid" };
  const sale: LiveSale = {
    team: state.latest.team,
    amount: state.latest.amount,
    contributions: [...state.latest.contributions],
    candidateId: state.activeCandidateId,
  };
  return {
    ok: true,
    sale,
    state: {
      cursor: state.cursor + 1,
      active: false,
      activeCandidateId: null,
      turn: state.turn,
      specialPass: false,
      latest: null,
      contributions: state.contributions.map((row) => row.map(() => 0)),
      skipped: [...state.skipped],
    },
  };
}

/**
 * Termination readiness (spec 7.2, issue #10).
 * Evaluated only after the active round resolves: no active candidate and
 * no unsettled confirmed bid. Ready when no unprocessed candidates remain
 * or when neither team is eligible (gold and free capacity).
 * Unpresented candidates stay unassigned; they are never marked skipped.
 */
export function isReadyToEnd(args: {
  active: boolean;
  latest: LiveLatestBid | null;
  cursor: number;
  candidateCount: number;
  eligible: [boolean, boolean];
}): boolean {
  if (args.active) return false;
  if (args.latest) return false;
  if (args.cursor >= args.candidateCount) return true;
  return !args.eligible[0] && !args.eligible[1];
}

export type PassResult =
  | { ok: true; state: LiveRoundState }
  | { ok: false; error: string };

/**
 * Special pass: allowed only when the opening turn was transferred because
 * the scheduled team was ineligible, and before any confirmed bid.
 */
export function passCandidate(state: LiveRoundState): PassResult {
  if (!state.active) return { ok: false, error: "no active round" };
  if (!state.specialPass) return { ok: false, error: "pass not allowed" };
  if (state.latest) return { ok: false, error: "pass not allowed" };
  if (!state.activeCandidateId)
    return { ok: false, error: "no active candidate" };
  return {
    ok: true,
    state: {
      cursor: state.cursor + 1,
      active: false,
      activeCandidateId: null,
      turn: state.turn,
      specialPass: false,
      latest: null,
      contributions: state.contributions.map((row) => row.map(() => 0)),
      skipped: [...state.skipped, state.activeCandidateId],
    },
  };
}
