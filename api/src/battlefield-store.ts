import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AccessError, visibility, type Visibility } from "./access.js";
import {
  AssetError,
  type AssetImage,
  type BattlefieldFields,
  validateAssetImage,
  validateBattlefield,
} from "./battlefield-domain.js";

export interface BattlefieldRecord extends BattlefieldFields, Visibility {
  id: string;
  archivedAt: string | null;
  image: AssetImage;
}

export type BattlefieldSummary = Omit<BattlefieldRecord, "image">;

export interface DraftBattlefield {
  auctionId: string;
  battlefieldId: string;
  name: string;
  geography: string;
  history: string;
  hasCustomImage: boolean;
  archivedAt: string | null;
}

interface BattlefieldRow extends BattlefieldFields {
  owner_user_id: string;
  is_public: boolean;
  id: string;
  archived_at: Date | null;
  image: Buffer;
  image_mime: string;
  image_name: string;
}

function summary(row: Omit<BattlefieldRow, "image" | "image_mime" | "image_name">, userId: string): BattlefieldSummary {
  return {
    ...visibility(row, userId),
    id: row.id,
    name: row.name,
    geography: row.geography,
    history: row.history,
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

function record(row: BattlefieldRow, userId: string): BattlefieldRecord {
  return {
    ...summary(row, userId),
    image: { buffer: Buffer.from(row.image), mime: row.image_mime, name: row.image_name },
  };
}

// The caller owns the shared pool and translates infrastructure errors at its boundary.
export class BattlefieldStore {
  constructor(private readonly pool: Pool, private readonly userId: string) {
    if (!userId) throw new AccessError();
  }

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

  private async lockBattlefield(client: PoolClient, id: string): Promise<BattlefieldRecord> {
    const result = await client.query<BattlefieldRow>("SELECT * FROM battlefields WHERE id=$1 AND owner_user_id=$2 FOR UPDATE", [id, this.userId]);
    if (!result.rows[0]) throw new AccessError();
    return record(result.rows[0], this.userId);
  }

  private async lockDraft(client: PoolClient, id: string): Promise<{ battlefield_id: string | null }> {
    const result = await client.query<{ status: string; battlefield_id: string | null }>(
      "SELECT status, battlefield_id FROM auctions WHERE id=$1 AND owner_user_id=$2 FOR UPDATE", [id, this.userId],
    );
    const row = result.rows[0];
    if (!row) throw new AccessError();
    if (row.status !== "draft") throw new AssetError("preparation locked");
    return row;
  }

  private async insert(client: PoolClient, fields: BattlefieldFields, image: AssetImage, isPublic = false): Promise<BattlefieldRecord> {
    const result = await client.query<BattlefieldRow>(
      "INSERT INTO battlefields (id,name,geography,history,image,image_mime,image_name,owner_user_id,is_public) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [randomUUID(), fields.name, fields.geography, fields.history, image.buffer, image.mime, image.name, this.userId, isPublic === true],
    );
    return record(result.rows[0], this.userId);
  }

  async create(fields: BattlefieldFields, image: AssetImage, isPublic = false): Promise<BattlefieldRecord> {
    const clean = validateBattlefield(fields);
    validateAssetImage(image);
    return this.transaction((client) => this.insert(client, clean, image, isPublic));
  }

  async list(includePublic = false): Promise<BattlefieldSummary[]> {
    const result = await this.pool.query<BattlefieldRow>(
      "SELECT id,name,geography,history,archived_at,owner_user_id,is_public FROM battlefields WHERE (owner_user_id=$1 OR ($2 AND is_public)) AND archived_at IS NULL ORDER BY created_at, id", [this.userId, includePublic === true],
    );
    return result.rows.map((row) => summary(row, this.userId));
  }

  async get(id: string): Promise<BattlefieldRecord> {
    const result = await this.pool.query<BattlefieldRow>("SELECT * FROM battlefields WHERE id=$1 AND (owner_user_id=$2 OR (is_public AND archived_at IS NULL))", [id, this.userId]);
    if (!result.rows[0]) throw new AccessError();
    return record(result.rows[0], this.userId);
  }

  async edit(id: string, fields: BattlefieldFields, image: AssetImage | null, isPublic?: boolean): Promise<BattlefieldRecord> {
    const clean = validateBattlefield(fields);
    if (image !== null) validateAssetImage(image);
    return this.transaction(async (client) => {
      const current = await this.lockBattlefield(client, id);
      if (current.archivedAt !== null) throw new AssetError("battlefield archived");
      const chosenImage = image ?? current.image;
      const references = await client.query<{ referenced: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM auctions WHERE battlefield_id=$1) AS referenced", [id],
      );
      if (references.rows[0].referenced) {
        const replacement = await this.insert(client, clean, chosenImage, isPublic ?? current.isPublic);
        await client.query("UPDATE battlefields SET archived_at=now() WHERE id=$1", [id]);
        return replacement;
      }
      const result = await client.query<BattlefieldRow>(
        "UPDATE battlefields SET name=$2,geography=$3,history=$4,image=$5,image_mime=$6,image_name=$7,is_public=$8 WHERE id=$1 RETURNING *",
        [id, clean.name, clean.geography, clean.history, chosenImage.buffer, chosenImage.mime, chosenImage.name, isPublic ?? current.isPublic],
      );
      return record(result.rows[0], this.userId);
    });
  }

  async archive(id: string): Promise<void> {
    await this.transaction(async (client) => {
      const current = await this.lockBattlefield(client, id);
      if (current.archivedAt === null) {
        await client.query("UPDATE battlefields SET archived_at=now() WHERE id=$1", [id]);
      }
    });
  }

  async select(auctionId: string, battlefieldId: string | null): Promise<void> {
    await this.transaction(async (client) => {
      // Battlefield first, then auction. Never acquire a battlefield lock after an
      // auction lock: edits/archive and competing selections share this order.
      const selected = battlefieldId === null ? null : await client.query<BattlefieldRow>("SELECT * FROM battlefields WHERE id=$1 FOR UPDATE", [battlefieldId]);
      if (selected && !selected.rows[0]) throw new AccessError();
      const battlefield = selected ? record(selected.rows[0], this.userId) : null;
      const auction = await this.lockDraft(client, auctionId);
      if (auction.battlefield_id === battlefieldId) return;
      if (battlefield && !battlefield.isOwner && (!battlefield.isPublic || battlefield.archivedAt)) throw new AccessError();
      if (battlefield?.archivedAt != null) throw new AssetError("battlefield archived");
      // A different selection discards the previous draft's overrides; the shared
      // battlefield record is never modified here.
      await client.query(
        "UPDATE auctions SET battlefield_id=$2, battlefield_geography=$3, battlefield_history=$4, battlefield_image=$5, battlefield_image_mime=$6, battlefield_image_name=$7, updated_at=now() WHERE id=$1",
        [auctionId, battlefieldId, battlefield && !battlefield.isOwner ? battlefield.geography : null, battlefield && !battlefield.isOwner ? battlefield.history : null, battlefield && !battlefield.isOwner ? battlefield.image.buffer : null, battlefield && !battlefield.isOwner ? battlefield.image.mime : null, battlefield && !battlefield.isOwner ? battlefield.image.name : null],
      );
    });
  }

  async getDraftBattlefield(auctionId: string): Promise<DraftBattlefield | null> {
    const result = await this.pool.query<{
      battlefield_id: string | null;
      battlefield_geography: string | null;
      battlefield_history: string | null;
      battlefield_image: Buffer | null;
    }>(
      "SELECT battlefield_id, battlefield_geography, battlefield_history, battlefield_image FROM auctions WHERE id=$1 AND owner_user_id=$2",
      [auctionId, this.userId],
    );
    const row = result.rows[0];
    if (!row) throw new AccessError();
    if (row.battlefield_id === null) return null;
    const baseResult = await this.pool.query<BattlefieldRow>("SELECT b.* FROM battlefields b JOIN auctions a ON a.battlefield_id=b.id WHERE a.id=$1 AND a.owner_user_id=$2", [auctionId, this.userId]);
    if (!baseResult.rows[0]) throw new AccessError();
    const base = record(baseResult.rows[0], this.userId);
    return {
      auctionId,
      battlefieldId: base.id,
      name: base.name,
      geography: row.battlefield_geography ?? base.geography,
      history: row.battlefield_history ?? base.history,
      hasCustomImage: row.battlefield_image !== null,
      archivedAt: base.archivedAt,
    };
  }

  async saveDraftBattlefield(
    auctionId: string,
    fields: { geography: string; history: string },
    image: AssetImage | undefined,
  ): Promise<DraftBattlefield> {
    const clean = validateBattlefield({ name: "draft", geography: fields.geography, history: fields.history });
    if (image !== undefined) validateAssetImage(image);
    return this.transaction(async (client) => {
      const auction = await this.lockDraft(client, auctionId);
      if (auction.battlefield_id === null) throw new AssetError("battlefield not found");
      // Re-read the shared record for identity; overrides never touch it.
      const baseResult = await client.query<BattlefieldRow>("SELECT b.* FROM battlefields b JOIN auctions a ON a.battlefield_id=b.id WHERE a.id=$1 AND a.owner_user_id=$2", [auctionId, this.userId]);
      if (!baseResult.rows[0]) throw new AssetError("battlefield not found");
      const base = record(baseResult.rows[0], this.userId);
      if (image !== undefined) {
        await client.query(
          "UPDATE auctions SET battlefield_geography=$2, battlefield_history=$3, battlefield_image=$4, battlefield_image_mime=$5, battlefield_image_name=$6, updated_at=now() WHERE id=$1",
          [auctionId, clean.geography, clean.history, image.buffer, image.mime, image.name],
        );
      } else {
        await client.query(
          "UPDATE auctions SET battlefield_geography=$2, battlefield_history=$3, updated_at=now() WHERE id=$1",
          [auctionId, clean.geography, clean.history],
        );
      }
      const check = await client.query<{ battlefield_image: Buffer | null }>(
        "SELECT battlefield_image FROM auctions WHERE id=$1", [auctionId],
      );
      return {
        auctionId,
        battlefieldId: base.id,
        name: base.name,
        geography: clean.geography,
        history: clean.history,
        hasCustomImage: check.rows[0].battlefield_image !== null,
        archivedAt: base.archivedAt,
      };
    });
  }

  async getDraftBattlefieldImage(auctionId: string): Promise<AssetImage> {
    const result = await this.pool.query<{
      battlefield_id: string | null;
      battlefield_image: Buffer | null;
      battlefield_image_mime: string | null;
      battlefield_image_name: string | null;
    }>(
      "SELECT battlefield_id, battlefield_image, battlefield_image_mime, battlefield_image_name FROM auctions WHERE id=$1 AND owner_user_id=$2",
      [auctionId, this.userId],
    );
    const row = result.rows[0];
    if (!row) throw new AccessError();
    if (row.battlefield_image !== null) {
      return { buffer: Buffer.from(row.battlefield_image), mime: row.battlefield_image_mime!, name: row.battlefield_image_name! };
    }
    if (row.battlefield_id === null) throw new AssetError("battlefield not found");
    const base = await this.pool.query<BattlefieldRow>("SELECT b.* FROM battlefields b JOIN auctions a ON a.battlefield_id=b.id WHERE a.id=$1 AND a.owner_user_id=$2", [auctionId, this.userId]);
    if (!base.rows[0]) throw new AccessError();
    return record(base.rows[0], this.userId).image;
  }

  async setBackground(auctionId: string, image: AssetImage | null): Promise<void> {
    if (image !== null) validateAssetImage(image);
    await this.transaction(async (client) => {
      await this.lockDraft(client, auctionId);
      await client.query(
        "UPDATE auctions SET background_image=$2,background_mime=$3,background_name=$4,updated_at=now() WHERE id=$1",
        [auctionId, image?.buffer ?? null, image?.mime ?? null, image?.name ?? null],
      );
    });
  }

  async getBackground(auctionId: string): Promise<AssetImage | null> {
    const result = await this.pool.query<{
      background_image: Buffer | null;
      background_mime: string | null;
      background_name: string | null;
    }>("SELECT background_image,background_mime,background_name FROM auctions WHERE id=$1 AND owner_user_id=$2", [auctionId, this.userId]);
    const row = result.rows[0];
    if (!row) throw new AccessError();
    if (row.background_image === null) return null;
    return { buffer: Buffer.from(row.background_image), mime: row.background_mime!, name: row.background_name! };
  }
}
