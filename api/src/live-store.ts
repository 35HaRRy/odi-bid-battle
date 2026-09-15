import type { Pool } from "pg";
import {
  completeSale as completeSalePure,
  confirmBid as confirmBidPure,
  isReadyToEnd,
  isTeamEligible,
  passCandidate as passPure,
  sendNextCandidate as sendPure,
  teamCapacity,
  type LiveRoundState,
} from "./live-domain.js";

export interface LiveMemberView {
  id: string;
  name: string;
  balance: number;
  contribution: number;
}

export interface LiveAcquired {
  candidateId: string;
  name: string;
  price: number;
}

export interface LiveTeamView {
  position: 0 | 1;
  name: string;
  remainingGold: number;
  acquiredCount: number;
  acquired: LiveAcquired[];
  members: LiveMemberView[];
}

export interface LiveView {
  auctionId: string;
  status: "ongoing" | "completed";
  cursor: number;
  active: boolean;
  activeCandidateId: string | null;
  turn: 0 | 1;
  specialPass: boolean;
  latest: { team: 0 | 1; amount: number; contributions: number[] } | null;
  contributions: number[][];
  skipped: string[];
  capacity: number;
  readyToEnd: boolean;
  teams: LiveTeamView[];
}

const LIVE_ERRORS = new Set([
  "round already active",
  "no remaining candidates",
  "no eligible team",
  "no active round",
  "not your turn",
  "team cannot bid",
  "invalid contributions",
  "invalid contribution",
  "bid must be positive",
  "bid must exceed latest bid",
  "pass not allowed",
  "no active candidate",
  "no confirmed bid",
  "active round must resolve",
  "settle confirmed bid",
  "termination not ready",
]);

export function isLiveError(message: string): boolean {
  return LIVE_ERRORS.has(message);
}

interface TeamRow {
  id: string;
  position: number;
  name: string;
}

interface MemberRow {
  id: string;
  team_id: string;
  name: string;
  initial_gold: number;
}

// Focused repository for the live bidding round. The caller (PgStore) owns
// the shared pool and translates infrastructure errors at its boundary.
export class LiveStore {
  constructor(private readonly pool: Pool) {}

  private async requireOngoing(auctionId: string): Promise<{ entries: string[]; status: string }> {
    return this.requireLive(auctionId, false);
  }

  private async requireLive(
    auctionId: string,
    allowCompleted: boolean,
  ): Promise<{ entries: string[]; status: string }> {
    const head = await this.pool.query<{ status: string }>(
      "SELECT status FROM auctions WHERE id=$1",
      [auctionId],
    );
    if (head.rows.length === 0) throw new Error("auction not found");
    if (head.rows[0].status === "draft") throw new Error("auction not started");
    if (head.rows[0].status === "completed" && !allowCompleted)
      throw new Error("auction completed");
    if (head.rows[0].status !== "ongoing" && head.rows[0].status !== "completed")
      throw new Error("auction completed");
    const e = await this.pool.query<{ candidate_id: string }>(
      "SELECT candidate_id FROM auction_entries WHERE auction_id=$1 ORDER BY position",
      [auctionId],
    );
    return { entries: e.rows.map((r) => r.candidate_id), status: head.rows[0].status };
  }

  private async loadTeams(auctionId: string): Promise<{ teams: TeamRow[]; members: MemberRow[] }> {
    const teams = await this.pool.query<TeamRow>(
      "SELECT id, position, name FROM auction_teams WHERE auction_id=$1 ORDER BY position",
      [auctionId],
    );
    if (teams.rows.length !== 2) throw new Error("auction teams missing");
    const members = await this.pool.query<MemberRow>(
      `SELECT m.id, m.team_id, m.name, m.initial_gold FROM auction_team_members m
       JOIN auction_teams t ON t.id = m.team_id
       WHERE t.auction_id=$1 ORDER BY t.position, m.created_at, m.id`,
      [auctionId],
    );
    return { teams: teams.rows, members: members.rows };
  }

  private async ensureBalances(
    auctionId: string,
    members: MemberRow[],
    client?: { query: Pool["query"] },
  ): Promise<Map<string, number>> {
    const q = client ?? this.pool;
    const existing = await q.query<{ member_id: string; balance: number }>(
      "SELECT member_id, balance FROM auction_live_balances WHERE auction_id=$1",
      [auctionId],
    );
    const map = new Map(existing.rows.map((r) => [r.member_id, r.balance]));
    for (const m of members) {
      if (!map.has(m.id)) {
        await q.query(
          "INSERT INTO auction_live_balances (auction_id, member_id, balance) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [auctionId, m.id, m.initial_gold],
        );
        map.set(m.id, m.initial_gold);
      }
    }
    return map;
  }

  private async acquiredCounts(auctionId: string): Promise<[number, number]> {
    const acquired = await this.pool.query<{ team_position: number }>(
      "SELECT team_position FROM auction_live_acquired WHERE auction_id=$1",
      [auctionId],
    );
    const counts: [number, number] = [0, 0];
    for (const r of acquired.rows) counts[r.team_position as 0 | 1]++;
    return counts;
  }

  private async readState(auctionId: string): Promise<LiveRoundState & { memberOrder: string[][] }> {
    const { teams, members } = await this.loadTeams(auctionId);
    const teamById = new Map(teams.map((t) => [t.id, t.position as 0 | 1]));
    const byTeam: string[][] = [[], []];
    for (const m of members) {
      byTeam[teamById.get(m.team_id) ?? 0].push(m.id);
    }
    const head = await this.pool.query<{
      cursor: number;
      active: boolean;
      active_candidate_id: string | null;
      turn: number;
      special_pass: boolean;
      latest_team: number | null;
      latest_amount: number | null;
    }>("SELECT cursor, active, active_candidate_id, turn, special_pass, latest_team, latest_amount FROM auction_live_state WHERE auction_id=$1", [auctionId]);
    const row = head.rows[0];
    const drafts = await this.pool.query<{ member_id: string; amount: number }>(
      "SELECT member_id, amount FROM auction_live_contributions WHERE auction_id=$1",
      [auctionId],
    );
    const draftMap = new Map(drafts.rows.map((r) => [r.member_id, r.amount]));
    const latestRows = await this.pool.query<{ member_id: string; amount: number }>(
      "SELECT member_id, amount FROM auction_live_latest WHERE auction_id=$1",
      [auctionId],
    );
    const latestMap = new Map(latestRows.rows.map((r) => [r.member_id, r.amount]));
    const skipped = await this.pool.query<{ candidate_id: string }>(
      "SELECT candidate_id FROM auction_live_skipped WHERE auction_id=$1 ORDER BY position",
      [auctionId],
    );
    const contributions = byTeam.map((ids) => ids.map((id) => draftMap.get(id) ?? 0));
    let latest: LiveRoundState["latest"] = null;
    if (row && row.latest_team !== null && row.latest_amount !== null) {
      const team = row.latest_team as 0 | 1;
      latest = {
        team,
        amount: row.latest_amount,
        contributions: byTeam[team].map((id) => latestMap.get(id) ?? 0),
      };
    }
    return {
      cursor: row?.cursor ?? 0,
      active: row?.active ?? false,
      activeCandidateId: row?.active_candidate_id ?? null,
      turn: (row?.turn ?? 0) as 0 | 1,
      specialPass: row?.special_pass ?? false,
      latest,
      contributions,
      skipped: skipped.rows.map((r) => r.candidate_id),
      memberOrder: byTeam,
    };
  }

  private async writeState(
    auctionId: string,
    state: LiveRoundState,
    memberOrder: string[][],
    latestByMember: Map<string, number> | null,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO auction_live_state (auction_id, cursor, active, active_candidate_id, turn, special_pass, latest_team, latest_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (auction_id) DO UPDATE SET cursor=$2, active=$3, active_candidate_id=$4, turn=$5, special_pass=$6, latest_team=$7, latest_amount=$8, updated_at=now()`,
        [
          auctionId,
          state.cursor,
          state.active,
          state.activeCandidateId,
          state.turn,
          state.specialPass,
          state.latest?.team ?? null,
          state.latest?.amount ?? null,
        ],
      );
      await client.query("DELETE FROM auction_live_contributions WHERE auction_id=$1", [auctionId]);
      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < memberOrder[t].length; i++) {
          await client.query(
            "INSERT INTO auction_live_contributions (auction_id, member_id, amount) VALUES ($1,$2,$3)",
            [auctionId, memberOrder[t][i], state.contributions[t][i] ?? 0],
          );
        }
      }
      await client.query("DELETE FROM auction_live_latest WHERE auction_id=$1", [auctionId]);
      if (state.latest && latestByMember) {
        for (const [memberId, amount] of latestByMember) {
          await client.query(
            "INSERT INTO auction_live_latest (auction_id, member_id, amount) VALUES ($1,$2,$3)",
            [auctionId, memberId, amount],
          );
        }
      }
      await client.query("DELETE FROM auction_live_skipped WHERE auction_id=$1", [auctionId]);
      for (let i = 0; i < state.skipped.length; i++) {
        await client.query(
          "INSERT INTO auction_live_skipped (auction_id, candidate_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [auctionId, state.skipped[i], i],
        );
      }
      await client.query("UPDATE auctions SET updated_at=now() WHERE id=$1", [auctionId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private teamGold(members: MemberRow[], balances: Map<string, number>, teamId: string): number {
    return members
      .filter((m) => m.team_id === teamId)
      .reduce((sum, m) => sum + (balances.get(m.id) ?? m.initial_gold), 0);
  }

  private async readiness(
    auctionId: string,
    entries: string[],
    teams: TeamRow[],
    members: MemberRow[],
    balances: Map<string, number>,
    state: LiveRoundState,
  ): Promise<{ eligible: [boolean, boolean]; readyToEnd: boolean }> {
    const acquiredCount = await this.acquiredCounts(auctionId);
    const eligible = [0, 1].map((pos) => {
      const team = teams.find((t) => t.position === pos)!;
      return isTeamEligible(
        this.teamGold(members, balances, team.id),
        acquiredCount[pos],
        entries.length,
      );
    }) as [boolean, boolean];
    return {
      eligible,
      readyToEnd: isReadyToEnd({
        active: state.active,
        latest: state.latest,
        cursor: state.cursor,
        candidateCount: entries.length,
        eligible,
      }),
    };
  }

  async getLive(auctionId: string): Promise<LiveView> {
    const { entries, status } = await this.requireLive(auctionId, true);
    const { teams, members } = await this.loadTeams(auctionId);
    const balances = await this.ensureBalances(auctionId, members);
    const state = await this.readState(auctionId);
    const { readyToEnd } = await this.readiness(
      auctionId,
      entries,
      teams,
      members,
      balances,
      state,
    );
    const acquired = await this.pool.query<{
      candidate_id: string;
      team_position: number;
      price: number;
      name: string;
    }>(
      `SELECT a.candidate_id, a.team_position, a.price, c.name
       FROM auction_live_acquired a
       JOIN candidates c ON c.id = a.candidate_id
       LEFT JOIN auction_entries e ON e.auction_id = a.auction_id AND e.candidate_id = a.candidate_id
       WHERE a.auction_id=$1 ORDER BY e.position`,
      [auctionId],
    );
    const acquiredByTeam: LiveAcquired[][] = [[], []];
    for (const r of acquired.rows)
      acquiredByTeam[r.team_position as 0 | 1].push({
        candidateId: r.candidate_id,
        name: r.name,
        price: r.price,
      });
    const capacity = teamCapacity(entries.length);
    const draftMap = new Map<string, number>();
    state.memberOrder.forEach((ids, t) =>
      ids.forEach((id, i) => draftMap.set(id, state.contributions[t][i] ?? 0)),
    );
    const views: LiveTeamView[] = [0, 1].map((pos) => {
      const team = teams.find((t) => t.position === pos)!;
      const ms = members.filter((m) => m.team_id === team.id);
      return {
        position: pos as 0 | 1,
        name: team.name,
        remainingGold: ms.reduce((s, m) => s + (balances.get(m.id) ?? m.initial_gold), 0),
        acquiredCount: acquiredByTeam[pos].length,
        acquired: acquiredByTeam[pos],
        members: ms.map((m) => ({
          id: m.id,
          name: m.name,
          balance: balances.get(m.id) ?? m.initial_gold,
          contribution: draftMap.get(m.id) ?? 0,
        })),
      };
    });
    return {
      auctionId,
      status: status as "ongoing" | "completed",
      cursor: state.cursor,
      active: state.active,
      activeCandidateId: state.activeCandidateId,
      turn: state.turn,
      specialPass: state.specialPass,
      latest: state.latest,
      contributions: state.contributions,
      skipped: state.skipped,
      capacity,
      readyToEnd,
      teams: views,
    };
  }

  async sendNext(auctionId: string): Promise<LiveView> {
    const { entries } = await this.requireOngoing(auctionId);
    const { teams, members } = await this.loadTeams(auctionId);
    const balances = await this.ensureBalances(auctionId, members);
    const state = await this.readState(auctionId);
    const acquiredCount = await this.acquiredCounts(auctionId);
    const eligible: [boolean, boolean] = [0, 1].map((pos) => {
      const team = teams.find((t) => t.position === pos)!;
      return isTeamEligible(
        this.teamGold(members, balances, team.id),
        acquiredCount[pos],
        entries.length,
      );
    }) as [boolean, boolean];
    const memberCounts: [number, number] = [0, 1].map(
      (pos) => members.filter((m) => m.team_id === teams.find((t) => t.position === pos)!.id).length,
    ) as [number, number];
    const next = sendPure(
      {
        cursor: state.cursor,
        active: state.active,
        activeCandidateId: state.activeCandidateId,
        turn: state.turn,
        specialPass: state.specialPass,
        latest: state.latest,
        contributions: state.contributions,
        skipped: state.skipped,
      },
      entries,
      eligible,
      memberCounts,
    );
    if (!next.ok) throw new Error(next.error);
    await this.writeState(auctionId, next.state, state.memberOrder, null);
    return this.getLive(auctionId);
  }

  async confirmBid(
    auctionId: string,
    team: 0 | 1,
    contributions: number[],
  ): Promise<LiveView> {
    const { entries } = await this.requireOngoing(auctionId);
    const { teams, members } = await this.loadTeams(auctionId);
    const balances = await this.ensureBalances(auctionId, members);
    const state = await this.readState(auctionId);
    const teamRow = teams.find((t) => t.position === team)!;
    const teamMembers = members.filter((m) => m.team_id === teamRow.id);
    const memberBalances = teamMembers.map((m) => balances.get(m.id) ?? m.initial_gold);
    const acquiredCount = await this.acquiredCounts(auctionId);
    const eligible = isTeamEligible(
      teamMembers.reduce((s, m) => s + (balances.get(m.id) ?? m.initial_gold), 0),
      acquiredCount[team],
      entries.length,
    );
    const next = confirmBidPure(
      team,
      {
        cursor: state.cursor,
        active: state.active,
        activeCandidateId: state.activeCandidateId,
        turn: state.turn,
        specialPass: state.specialPass,
        latest: state.latest,
        contributions: state.contributions,
        skipped: state.skipped,
      },
      contributions,
      memberBalances,
      eligible,
    );
    if (!next.ok) throw new Error(next.error);
    const latestByMember = new Map<string, number>();
    teamMembers.forEach((m, i) => latestByMember.set(m.id, contributions[i]));
    await this.writeState(auctionId, next.state, state.memberOrder, latestByMember);
    return this.getLive(auctionId);
  }

  async sell(auctionId: string): Promise<LiveView> {
    await this.requireOngoing(auctionId);
    const { teams, members } = await this.loadTeams(auctionId);
    const balances = await this.ensureBalances(auctionId, members);
    const state = await this.readState(auctionId);
    const next = completeSalePure({
      cursor: state.cursor,
      active: state.active,
      activeCandidateId: state.activeCandidateId,
      turn: state.turn,
      specialPass: state.specialPass,
      latest: state.latest,
      contributions: state.contributions,
      skipped: state.skipped,
    });
    if (!next.ok) throw new Error(next.error);
    const { sale, state: settled } = next;
    const winnerRow = teams.find((t) => t.position === sale.team)!;
    const winnerMembers = members.filter((m) => m.team_id === winnerRow.id);
    const winnerOrder = state.memberOrder[sale.team];
    const deductions = new Map<string, number>();
    winnerOrder.forEach((id, i) => deductions.set(id, sale.contributions[i] ?? 0));
    for (const m of winnerMembers) {
      const current = balances.get(m.id) ?? m.initial_gold;
      if (current - (deductions.get(m.id) ?? 0) < 0)
        throw new Error("invalid contribution");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO auction_live_acquired (auction_id, candidate_id, team_position, price) VALUES ($1,$2,$3,$4)",
        [auctionId, sale.candidateId, sale.team, sale.amount],
      );
      for (const m of winnerMembers) {
        const deduction = deductions.get(m.id) ?? 0;
        if (deduction === 0) continue;
        await client.query(
          "UPDATE auction_live_balances SET balance = balance - $1 WHERE auction_id=$2 AND member_id=$3",
          [deduction, auctionId, m.id],
        );
      }
      await client.query(
        `INSERT INTO auction_live_state (auction_id, cursor, active, active_candidate_id, turn, special_pass, latest_team, latest_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (auction_id) DO UPDATE SET cursor=$2, active=$3, active_candidate_id=$4, turn=$5, special_pass=$6, latest_team=$7, latest_amount=$8, updated_at=now()`,
        [
          auctionId,
          settled.cursor,
          settled.active,
          settled.activeCandidateId,
          settled.turn,
          settled.specialPass,
          null,
          null,
        ],
      );
      await client.query("DELETE FROM auction_live_contributions WHERE auction_id=$1", [auctionId]);
      for (let t = 0; t < 2; t++) {
        for (let i = 0; i < state.memberOrder[t].length; i++) {
          await client.query(
            "INSERT INTO auction_live_contributions (auction_id, member_id, amount) VALUES ($1,$2,$3)",
            [auctionId, state.memberOrder[t][i], 0],
          );
        }
      }
      await client.query("DELETE FROM auction_live_latest WHERE auction_id=$1", [auctionId]);
      await client.query("DELETE FROM auction_live_skipped WHERE auction_id=$1", [auctionId]);
      for (let i = 0; i < settled.skipped.length; i++) {
        await client.query(
          "INSERT INTO auction_live_skipped (auction_id, candidate_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [auctionId, settled.skipped[i], i],
        );
      }
      await client.query("UPDATE auctions SET updated_at=now() WHERE id=$1", [auctionId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return this.getLive(auctionId);
  }

  async endAuction(auctionId: string): Promise<LiveView> {
    const { entries } = await this.requireOngoing(auctionId);
    const { teams, members } = await this.loadTeams(auctionId);
    const balances = await this.ensureBalances(auctionId, members);
    const state = await this.readState(auctionId);
    if (state.active) throw new Error("active round must resolve");
    if (state.latest) throw new Error("settle confirmed bid");
    const { readyToEnd } = await this.readiness(
      auctionId,
      entries,
      teams,
      members,
      balances,
      state,
    );
    if (!readyToEnd) throw new Error("termination not ready");
    await this.pool.query("UPDATE auctions SET status='completed', updated_at=now() WHERE id=$1", [
      auctionId,
    ]);
    return this.getLive(auctionId);
  }

  async pass(auctionId: string): Promise<LiveView> {
    await this.requireOngoing(auctionId);
    const state = await this.readState(auctionId);
    const next = passPure({
      cursor: state.cursor,
      active: state.active,
      activeCandidateId: state.activeCandidateId,
      turn: state.turn,
      specialPass: state.specialPass,
      latest: state.latest,
      contributions: state.contributions,
      skipped: state.skipped,
    });
    if (!next.ok) throw new Error(next.error);
    await this.writeState(auctionId, next.state, state.memberOrder, null);
    return this.getLive(auctionId);
  }
}
