import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AssetError } from "./battlefield-domain.js";
import type { AuctionTeam } from "./domain.js";

interface TeamRow {
  id: string;
  auction_id: string;
  name: string;
  slogan: string | null;
  flag_image: Buffer;
  flag_mime: string;
  flag_name: string;
  position: number;
  created_at: Date;
}

interface MemberRow {
  id: string;
  team_id: string;
  name: string;
  avatar_image: Buffer | null;
  avatar_mime: string | null;
  avatar_name: string | null;
  initial_gold: number;
  created_at: Date;
}

function toTeam(row: TeamRow, members: MemberRow[]): AuctionTeam {
  return {
    id: row.id,
    auctionId: row.auction_id,
    name: row.name,
    slogan: row.slogan,
    flag: { buffer: Buffer.from(row.flag_image), mime: row.flag_mime, name: row.flag_name },
    position: row.position as 0 | 1,
    members: members.map((m) => ({
      id: m.id,
      teamId: m.team_id,
      name: m.name,
      avatar: {
        buffer: m.avatar_image ? Buffer.from(m.avatar_image) : null,
        mime: m.avatar_mime,
        name: m.avatar_name,
      },
      initialGold: m.initial_gold,
      createdAt: (m.created_at as Date).toISOString(),
    })),
    createdAt: (row.created_at as Date).toISOString(),
  };
}

// Focused repository for auction-scoped teams. The caller (PgStore) owns the
// shared pool and translates infrastructure errors at its boundary.
export class TeamStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockDraft(client: PoolClient, auctionId: string): Promise<void> {
    const result = await client.query<{ status: string }>(
      "SELECT status FROM auctions WHERE id=$1 FOR UPDATE",
      [auctionId],
    );
    const row = result.rows[0];
    if (!row) throw new AssetError("auction not found");
    if (row.status !== "draft") throw new AssetError("preparation locked");
  }

  async getAuctionTeams(auctionId: string): Promise<AuctionTeam[]> {
    const exists = await this.pool.query("SELECT 1 FROM auctions WHERE id=$1", [auctionId]);
    if (exists.rows.length === 0) throw new AssetError("auction not found");
    const teams = await this.pool.query<TeamRow>(
      "SELECT * FROM auction_teams WHERE auction_id=$1 ORDER BY position, created_at, id",
      [auctionId],
    );
    const out: AuctionTeam[] = [];
    for (const row of teams.rows) {
      const members = await this.pool.query<MemberRow>(
        "SELECT * FROM auction_team_members WHERE team_id=$1 ORDER BY created_at, id",
        [row.id],
      );
      out.push(toTeam(row, members.rows));
    }
    return out;
  }

  // Full replace per auction: existing teams (and their members via cascade)
  // are removed, then the submitted array is written atomically. Inequality is
  // permitted here; equal budgets are a review-time readiness rule.
  async saveAuctionTeams(auctionId: string, teams: AuctionTeam[]): Promise<AuctionTeam[]> {
    await this.transaction(async (client) => {
      await this.lockDraft(client, auctionId);
      await client.query("DELETE FROM auction_teams WHERE auction_id=$1", [auctionId]);
      for (const team of teams) {
        const teamId = randomUUID();
        await client.query(
          "INSERT INTO auction_teams (id, auction_id, name, slogan, flag_image, flag_mime, flag_name, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [teamId, auctionId, team.name, team.slogan, team.flag.buffer, team.flag.mime, team.flag.name, team.position],
        );
        for (const member of team.members) {
          await client.query(
            "INSERT INTO auction_team_members (id, team_id, name, avatar_image, avatar_mime, avatar_name, initial_gold) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              teamId,
              member.name,
              member.avatar.buffer,
              member.avatar.mime,
              member.avatar.name,
              member.initialGold,
            ],
          );
        }
      }
      await client.query("UPDATE auctions SET updated_at=now() WHERE id=$1", [auctionId]);
    });
    return this.getAuctionTeams(auctionId);
  }
}
