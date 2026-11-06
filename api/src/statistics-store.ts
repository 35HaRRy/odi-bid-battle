import { AccessError } from "./access.js";
import type { AuctionStatistics, StatisticsOverview } from "./statistics-types.js";

type Queryable = { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export async function readStatistics(q: Queryable, userId: string): Promise<StatisticsOverview> {
  const result = await q.query(`SELECT
    (SELECT count(*)::int FROM candidates WHERE owner_user_id=$1 AND archived_at IS NULL) AS candidates,
    (SELECT count(*)::int FROM candidate_lists WHERE owner_user_id=$1 AND archived_at IS NULL) AS lists,
    (SELECT count(*)::int FROM battlefields WHERE owner_user_id=$1 AND archived_at IS NULL) AS battlefields,
    COALESCE((SELECT jsonb_agg(to_jsonb(report) ORDER BY report.created_at DESC, report.id) FROM (
      SELECT a.id, a.name, a.status, a.created_at,
        count(s.candidate_id)::int AS "soldCount", COALESCE(sum(s.price),0) AS "spentGold"
      FROM auctions a LEFT JOIN auction_live_acquired s ON s.auction_id=a.id
      WHERE a.owner_user_id=$1 GROUP BY a.id
    ) report), '[]'::jsonb) AS auctions`, [userId]);
  return result.rows[0] as unknown as StatisticsOverview;
}

export async function readAuctionStatistics(q: Queryable, userId: string, id: string): Promise<AuctionStatistics> {
  // One statement gives all sections the same database snapshot without locking or mutating live state.
  const result = await q.query(`SELECT a.id, a.name, a.status,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'position', t.position, 'name', t.name,
      'spentGold', COALESCE((SELECT sum(s.price) FROM auction_live_acquired s WHERE s.auction_id=a.id AND s.team_position=t.position),0),
      'remainingGold', COALESCE((SELECT sum(COALESCE(b.balance,m.initial_gold)) FROM auction_team_members m
        LEFT JOIN auction_live_balances b ON b.auction_id=a.id AND b.member_id=m.id WHERE m.team_id=t.id),0),
      'acquiredCount', (SELECT count(*) FROM auction_live_acquired s WHERE s.auction_id=a.id AND s.team_position=t.position),
      'members', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'spentGold', m.initial_gold-COALESCE(b.balance,m.initial_gold),
        'remainingGold', COALESCE(b.balance,m.initial_gold)) ORDER BY m.created_at,m.id)
        FROM auction_team_members m LEFT JOIN auction_live_balances b ON b.auction_id=a.id AND b.member_id=m.id
        WHERE m.team_id=t.id), '[]'::jsonb)
    ) ORDER BY t.position) FROM auction_teams t WHERE t.auction_id=a.id), '[]'::jsonb) AS teams,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'candidateId', s.candidate_id, 'name', c.name, 'price', s.price, 'winner', s.team_position,
      'winningContributions', CASE WHEN sale.id IS NULL THEN NULL ELSE (
        SELECT jsonb_agg(jsonb_build_object('name', m.name, 'amount', r.amount) ORDER BY m.created_at,m.id)
        FROM jsonb_to_recordset(sale.snapshot->'latestRows') AS r(member_id text, amount int)
        JOIN auction_team_members m ON m.id=r.member_id
        JOIN auction_teams t ON t.id=m.team_id AND t.auction_id=a.id AND t.position=s.team_position
      ) END,
      'losingContributions', CASE WHEN sale.id IS NULL THEN NULL
        WHEN losing.id IS NOT NULL THEN (
          SELECT jsonb_agg(jsonb_build_object('name', m.name, 'amount', r.amount) ORDER BY m.created_at,m.id)
          FROM jsonb_to_recordset(losing.snapshot->'latestRows') AS r(member_id text, amount int)
          JOIN auction_team_members m ON m.id=r.member_id
          JOIN auction_teams t ON t.id=m.team_id AND t.auction_id=a.id AND t.position<>s.team_position
        )
        WHEN EXISTS (SELECT 1 FROM auction_live_history h WHERE h.auction_id=a.id AND h.id<=sale.id
          AND h.snapshot->>'activeCandidateId'=s.candidate_id
          AND h.snapshot->>'cursor'=sale.snapshot->>'cursor' AND h.snapshot->>'latestTeam' IS NULL)
        THEN '[]'::jsonb ELSE NULL END
    ) ORDER BY e.position,s.candidate_id)
      FROM auction_live_acquired s JOIN candidates c ON c.id=s.candidate_id
      LEFT JOIN auction_entries e ON e.auction_id=a.id AND e.candidate_id=s.candidate_id
      LEFT JOIN LATERAL (
        SELECT h.id,h.snapshot FROM auction_live_history h WHERE h.auction_id=a.id
          AND h.snapshot->>'activeCandidateId'=s.candidate_id
          AND (h.snapshot->>'latestTeam')::int=s.team_position
          AND (h.snapshot->>'latestAmount')::int=s.price
        ORDER BY h.id DESC LIMIT 1
      ) sale ON true
      LEFT JOIN LATERAL (
        SELECT h.id,h.snapshot FROM auction_live_history h WHERE h.auction_id=a.id AND h.id<sale.id
          AND h.snapshot->>'activeCandidateId'=s.candidate_id
          AND h.snapshot->>'cursor'=sale.snapshot->>'cursor'
          AND (h.snapshot->>'latestTeam')::int<>s.team_position
        ORDER BY h.id DESC LIMIT 1
      ) losing ON true
      WHERE s.auction_id=a.id), '[]'::jsonb) AS sales
    FROM auctions a WHERE a.id=$2 AND a.owner_user_id=$1`, [userId, id]);
  if (!result.rows[0]) throw new AccessError();
  return result.rows[0] as unknown as AuctionStatistics;
}
