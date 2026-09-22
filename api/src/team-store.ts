import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AssetError, validateAssetImage } from "./battlefield-domain.js";
import type { AuctionTeam } from "./domain.js";

export interface TeamImageUpload {
  id: string;
  auctionId: string;
  buffer: Buffer;
  mime: string;
  name: string;
  createdAt: string;
}

interface TeamImageUploadRow {
  id: string;
  auction_id: string;
  image: Buffer;
  image_mime: string;
  image_name: string;
  created_at: Date;
}

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

  async saveTeamImageUpload(
    auctionId: string,
    image: { buffer: Buffer; mime: string; name: string },
  ): Promise<TeamImageUpload> {
    validateAssetImage(image);
    if (!image.name.trim()) throw new AssetError("invalid image");
    const exists = await this.pool.query("SELECT status FROM auctions WHERE id=$1", [auctionId]);
    const row = exists.rows[0] as { status: string } | undefined;
    if (!row) throw new AssetError("auction not found");
    if (row.status !== "draft") throw new AssetError("preparation locked");
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO auction_team_image_uploads (id, auction_id, image, image_mime, image_name) VALUES ($1,$2,$3,$4,$5)",
      [id, auctionId, image.buffer, image.mime, image.name],
    );
    await this.pool
      .query("DELETE FROM auction_team_image_uploads WHERE created_at < now() - interval '24 hours'")
      .catch(() => undefined);
    const saved = await this.pool.query<TeamImageUploadRow>(
      "SELECT * FROM auction_team_image_uploads WHERE id=$1",
      [id],
    );
    const savedRow = saved.rows[0];
    return {
      id: savedRow.id,
      auctionId: savedRow.auction_id,
      buffer: Buffer.from(savedRow.image),
      mime: savedRow.image_mime,
      name: savedRow.image_name,
      createdAt: (savedRow.created_at as Date).toISOString(),
    };
  }

  async getTeamImageUpload(uploadId: string): Promise<TeamImageUpload> {
    const result = await this.pool.query<TeamImageUploadRow>(
      "SELECT * FROM auction_team_image_uploads WHERE id=$1",
      [uploadId],
    );
    const row = result.rows[0];
    if (!row) throw new AssetError("invalid image");
    return {
      id: row.id,
      auctionId: row.auction_id,
      buffer: Buffer.from(row.image),
      mime: row.image_mime,
      name: row.image_name,
      createdAt: (row.created_at as Date).toISOString(),
    };
  }

  async getTeamFlagImage(teamId: string): Promise<{ buffer: Buffer; mime: string; name: string }> {
    const result = await this.pool.query<{
      flag_image: Buffer;
      flag_mime: string;
      flag_name: string;
    }>("SELECT flag_image, flag_mime, flag_name FROM auction_teams WHERE id=$1", [teamId]);
    const row = result.rows[0];
    if (!row) throw new AssetError("invalid image");
    return { buffer: Buffer.from(row.flag_image), mime: row.flag_mime, name: row.flag_name };
  }

  async getMemberAvatarImage(memberId: string): Promise<{ buffer: Buffer; mime: string; name: string } | null> {
    const result = await this.pool.query<{
      avatar_image: Buffer | null;
      avatar_mime: string | null;
      avatar_name: string | null;
    }>("SELECT avatar_image, avatar_mime, avatar_name FROM auction_team_members WHERE id=$1", [memberId]);
    const row = result.rows[0];
    if (!row) throw new AssetError("invalid image");
    if (!row.avatar_image) return null;
    return {
      buffer: Buffer.from(row.avatar_image),
      mime: row.avatar_mime ?? "",
      name: row.avatar_name ?? "",
    };
  }

  async deleteTeamImageUploads(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query("DELETE FROM auction_team_image_uploads WHERE id=ANY($1)", [ids]).catch(() => undefined);
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
