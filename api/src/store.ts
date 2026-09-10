import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { AssetError } from "./battlefield-domain.js";
import { BattlefieldStore } from "./battlefield-store.js";

export class PersistenceError extends Error {
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "PersistenceError";
  }
}

export interface CandidateRecord {
  id: string;
  name: string;
  image: Buffer;
  imageMime: string;
  imageName: string;
  archivedAt: string | null;
}

export interface CandidateImageInput {
  buffer: Buffer;
  mime: string;
  name: string;
}

export interface CandidateListRecord {
  id: string;
  name: string;
  isDraft: boolean;
  archivedAt: string | null;
  entries: string[];
}

export interface AuctionRecord {
  id: string;
  name: string;
  sourceListId: string | null;
  followsSource: boolean;
  entries: string[];
  battlefieldId: string | null;
  status: string;
}

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

function pgError(message: string, cause: unknown): PersistenceError {
  return new PersistenceError(message, { cause });
}

function cleanCandidateName(name: string): string {
  const clean = name.trim();
  if (!clean || clean.length > 200) throw new Error("invalid name");
  return clean;
}

function assertValidImage(image: CandidateImageInput | null): void {
  if (image && image.buffer.length === 0) throw new Error("invalid image");
}

function resolvedImage(
  current: CandidateRecord,
  image: CandidateImageInput | null,
): { buffer: Buffer; mime: string; name: string } {
  return {
    buffer: image ? image.buffer : Buffer.from(current.image),
    mime: image ? image.mime : current.imageMime,
    name: image ? image.name : current.imageName,
  };
}

export class PgStore {
  private pool: Pool | null;
  private q: Queryable;
  private assetStore?: Pick<BattlefieldStore, keyof BattlefieldStore>;

  constructor(pool: Queryable & { end?: () => Promise<void> }) {
    this.q = pool;
    this.pool = pool as Pool;
  }

  get battlefields(): Pick<BattlefieldStore, keyof BattlefieldStore> {
    if (!this.assetStore) {
      if (!this.pool || typeof this.pool.connect !== "function") {
        throw pgError("failed to access battlefield storage", new Error("no pool"));
      }
      const assets = new BattlefieldStore(this.pool);
      // Wrap at this boundary so the focused repository never imports PgStore.
      const run = async <T>(operation: () => Promise<T>): Promise<T> => {
        try {
          return await operation();
        } catch (err) {
          if (err instanceof AssetError || err instanceof PersistenceError) throw err;
          throw pgError("failed to persist battlefield assets", err);
        }
      };
      this.assetStore = {
        create: (fields, image) => run(() => assets.create(fields, image)),
        list: () => run(() => assets.list()),
        get: (id) => run(() => assets.get(id)),
        edit: (id, fields, image) => run(() => assets.edit(id, fields, image)),
        archive: (id) => run(() => assets.archive(id)),
        select: (auctionId, battlefieldId) => run(() => assets.select(auctionId, battlefieldId)),
        setBackground: (auctionId, image) => run(() => assets.setBackground(auctionId, image)),
        getBackground: (auctionId) => run(() => assets.getBackground(auctionId)),
      };
    }
    return this.assetStore;
  }

  static async connect(url: string): Promise<PgStore> {
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      await pool.end().catch(() => undefined);
      throw new PersistenceError("database unavailable", { cause: err });
    }
    return new PgStore(pool);
  }

  async close(): Promise<void> {
    await this.pool?.end?.().catch(() => undefined);
  }

  async saveCandidate(
    name: string,
    image: Buffer,
    imageMime: string,
    imageName: string,
  ): Promise<CandidateRecord> {
    const clean = name.trim();
    if (!clean || clean.length > 200) throw new Error("invalid name");
    if (image.length === 0) throw new Error("invalid image");
    const id = randomUUID();
    try {
      await this.q.query(
        "INSERT INTO candidates (id, name, image, image_mime, image_name) VALUES ($1,$2,$3,$4,$5)",
        [id, clean, image, imageMime, imageName],
      );
      return (await this.getCandidate(id)) as CandidateRecord;
    } catch (err) {
      throw pgError("failed to save candidate", err);
    }
  }

  async getCandidate(id: string): Promise<CandidateRecord> {
    try {
      const r = await this.q.query("SELECT * FROM candidates WHERE id=$1", [id]);
      const row = r.rows[0] as unknown as Record<string, unknown> | undefined;
      if (!row) throw new Error("candidate not found");
      return {
        id: row.id as string,
        name: row.name as string,
        image: Buffer.from(row.image as Uint8Array),
        imageMime: row.image_mime as string,
        imageName: row.image_name as string,
        archivedAt: (row.archived_at as string | null) ?? null,
      };
    } catch (err) {
      if ((err as Error).message === "candidate not found") throw err;
      throw pgError("failed to read candidate", err);
    }
  }

  async listCandidates(): Promise<CandidateRecord[]> {
    try {
      const r = await this.q.query(
        "SELECT id, name FROM candidates WHERE archived_at IS NULL ORDER BY created_at, name",
      );
      return (r.rows as unknown as { id: string; name: string }[]).map((row) => ({
        id: row.id,
        name: row.name,
        image: Buffer.alloc(0),
        imageMime: "",
        imageName: "",
        archivedAt: null,
      }));
    } catch (err) {
      throw pgError("failed to list candidates", err);
    }
  }

  async archiveCandidate(id: string): Promise<void> {
    try {
      await this.q.query(
        "UPDATE candidates SET archived_at=now() WHERE id=$1",
        [id],
      );
    } catch (err) {
      throw pgError("failed to archive candidate", err);
    }
  }

  async saveList(name: string, isDraft: boolean): Promise<CandidateListRecord> {
    if (!isDraft && (!name.trim() || name.length > 200))
      throw new Error("invalid name");
    const id = randomUUID();
    try {
      await this.q.query(
        "INSERT INTO candidate_lists (id, name, is_draft) VALUES ($1,$2,$3)",
        [id, name, isDraft],
      );
      return (await this.getList(id)) as CandidateListRecord;
    } catch (err) {
      throw pgError("failed to save list", err);
    }
  }

  async listLists(): Promise<CandidateListRecord[]> {
    try {
      const r = await this.q.query(
        "SELECT id FROM candidate_lists WHERE archived_at IS NULL ORDER BY created_at",
      );
      const out: CandidateListRecord[] = [];
      for (const row of r.rows as unknown as { id: string }[])
        out.push(await this.getList(row.id));
      return out;
    } catch (err) {
      throw pgError("failed to list lists", err);
    }
  }

  async getList(id: string): Promise<CandidateListRecord> {
    try {
      const l = await this.q.query(
        "SELECT id, name, is_draft, archived_at FROM candidate_lists WHERE id=$1",
        [id],
      );
      const head = l.rows[0] as unknown as
        | { id: string; name: string; is_draft: boolean; archived_at: string | null }
        | undefined;
      if (!head) throw new Error("list not found");
      const e = await this.q.query(
        "SELECT candidate_id FROM list_entries WHERE list_id=$1 ORDER BY position",
        [id],
      );
      return {
        id: head.id,
        name: head.name,
        isDraft: head.is_draft,
        archivedAt: head.archived_at ?? null,
        entries: (e.rows as unknown as { candidate_id: string }[]).map(
          (r) => r.candidate_id,
        ),
      };
    } catch (err) {
      if ((err as Error).message === "list not found") throw err;
      throw pgError("failed to read list", err);
    }
  }

  async archiveList(id: string): Promise<void> {
    try {
      await this.q.query(
        "UPDATE candidate_lists SET archived_at=now() WHERE id=$1",
        [id],
      );
    } catch (err) {
      throw pgError("failed to archive list", err);
    }
  }

  async isCandidateReferenced(id: string): Promise<boolean> {
    try {
      const l = await this.q.query(
        "SELECT 1 FROM list_entries WHERE candidate_id=$1 LIMIT 1",
        [id],
      );
      if (l.rows.length > 0) return true;
      const a = await this.q.query(
        "SELECT 1 FROM auction_entries WHERE candidate_id=$1 LIMIT 1",
        [id],
      );
      return a.rows.length > 0;
    } catch (err) {
      throw pgError("failed to check candidate references", err);
    }
  }

  async editCatalogCandidate(
    id: string,
    name: string,
    image: CandidateImageInput | null,
  ): Promise<CandidateRecord> {
    const clean = cleanCandidateName(name);
    assertValidImage(image);
    try {
      const current = await this.getCandidate(id);
      const referenced = await this.isCandidateReferenced(id);
      if (!referenced) {
        if (image) {
          await this.q.query(
            "UPDATE candidates SET name=$2, image=$3, image_mime=$4, image_name=$5 WHERE id=$1",
            [id, clean, image.buffer, image.mime, image.name],
          );
        } else {
          await this.q.query("UPDATE candidates SET name=$2 WHERE id=$1", [
            id,
            clean,
          ]);
        }
        return await this.getCandidate(id);
      }
      const nextId = randomUUID();
      const img = resolvedImage(current, image);
      await this.q.query(
        "INSERT INTO candidates (id, name, image, image_mime, image_name) VALUES ($1,$2,$3,$4,$5)",
        [nextId, clean, img.buffer, img.mime, img.name],
      );
      await this.q.query(
        "UPDATE candidates SET archived_at=now() WHERE id=$1",
        [id],
      );
      return (await this.getCandidate(nextId)) as CandidateRecord;
    } catch (err) {
      if (
        (err as Error).message === "candidate not found" ||
        /invalid (name|image)/i.test((err as Error).message)
      )
        throw err;
      if (err instanceof PersistenceError) throw err;
      throw pgError("failed to edit candidate", err);
    }
  }

  async editListEntryCandidate(
    listId: string,
    oldCandidateId: string,
    name: string,
    image: CandidateImageInput | null,
  ): Promise<CandidateRecord> {
    const clean = cleanCandidateName(name);
    assertValidImage(image);
    try {
      const list = await this.getList(listId);
      if (!list.entries.includes(oldCandidateId))
        throw new Error("entry not found");
      const current = await this.getCandidate(oldCandidateId);
      const nextId = randomUUID();
      const img = resolvedImage(current, image);
      await this.q.query(
        "INSERT INTO candidates (id, name, image, image_mime, image_name) VALUES ($1,$2,$3,$4,$5)",
        [nextId, clean, img.buffer, img.mime, img.name],
      );
      const pos = await this.q.query(
        "SELECT position FROM list_entries WHERE list_id=$1 AND candidate_id=$2",
        [listId, oldCandidateId],
      );
      const position = (pos.rows[0] as unknown as { position: number }).position;
      await this.q.query(
        "DELETE FROM list_entries WHERE list_id=$1 AND candidate_id=$2",
        [listId, oldCandidateId],
      );
      await this.q.query(
        "INSERT INTO list_entries (list_id, candidate_id, position) VALUES ($1,$2,$3)",
        [listId, nextId, position],
      );
      return (await this.getCandidate(nextId)) as CandidateRecord;
    } catch (err) {
      if (
        (err as Error).message === "entry not found" ||
        (err as Error).message === "candidate not found" ||
        (err as Error).message === "list not found" ||
        /invalid (name|image)/i.test((err as Error).message)
      )
        throw err;
      if (err instanceof PersistenceError) throw err;
      throw pgError("failed to edit list candidate", err);
    }
  }

  async editDraftEntryCandidate(
    auctionId: string,
    oldCandidateId: string,
    name: string,
    image: CandidateImageInput | null,
  ): Promise<CandidateRecord> {
    const clean = cleanCandidateName(name);
    assertValidImage(image);
    try {
      await this.ensureForked(auctionId);
      const cur = await this.getAuction(auctionId);
      if (!cur.entries.includes(oldCandidateId))
        throw new Error("entry not found");
      const current = await this.getCandidate(oldCandidateId);
      const nextId = randomUUID();
      const img = resolvedImage(current, image);
      await this.q.query(
        "INSERT INTO candidates (id, name, image, image_mime, image_name) VALUES ($1,$2,$3,$4,$5)",
        [nextId, clean, img.buffer, img.mime, img.name],
      );
      const pos = await this.q.query(
        "SELECT position FROM auction_entries WHERE auction_id=$1 AND candidate_id=$2",
        [auctionId, oldCandidateId],
      );
      const position = (pos.rows[0] as unknown as { position: number })
        .position;
      await this.q.query(
        "DELETE FROM auction_entries WHERE auction_id=$1 AND candidate_id=$2",
        [auctionId, oldCandidateId],
      );
      await this.q.query(
        "INSERT INTO auction_entries (auction_id, candidate_id, position) VALUES ($1,$2,$3)",
        [auctionId, nextId, position],
      );
      await this.q.query(
        "UPDATE auctions SET updated_at=now() WHERE id=$1",
        [auctionId],
      );
      return (await this.getCandidate(nextId)) as CandidateRecord;
    } catch (err) {
      if (
        (err as Error).message === "entry not found" ||
        (err as Error).message === "candidate not found" ||
        (err as Error).message === "auction not found" ||
        /invalid (name|image)/i.test((err as Error).message)
      )
        throw err;
      if (err instanceof PersistenceError) throw err;
      throw pgError("failed to edit draft candidate", err);
    }
  }

  async addEntryToList(listId: string, candidateId: string): Promise<void> {
    const current = await this.getList(listId);
    if (current.entries.includes(candidateId))
      throw new Error("duplicate entry");
    const pool = this.pool;
    if (!pool || typeof (pool as Pool).connect !== "function") {
      throw pgError("failed to add entry", new Error("no pool"));
    }
    let client: PoolClient | null = null;
    try {
      client = await (pool as Pool).connect();
      await client.query("BEGIN");
      const r = await client.query(
        "SELECT COALESCE(MAX(position),-1)+1 AS pos FROM list_entries WHERE list_id=$1",
        [listId],
      );
      const pos = (r.rows[0] as unknown as { pos: number }).pos;
      await client.query(
        "INSERT INTO list_entries (list_id, candidate_id, position) VALUES ($1,$2,$3)",
        [listId, candidateId, pos],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client?.query("ROLLBACK").catch(() => undefined);
      if (/duplicate|unique|PRIMARY/i.test((err as Error).message))
        throw new Error("duplicate entry");
      throw pgError("failed to add entry", err);
    } finally {
      client?.release();
    }
  }

  async removeEntryFromList(listId: string, candidateId: string): Promise<void> {
    try {
      await this.q.query(
        "DELETE FROM list_entries WHERE list_id=$1 AND candidate_id=$2",
        [listId, candidateId],
      );
      await this.normalizePositions(listId);
    } catch (err) {
      throw pgError("failed to remove entry", err);
    }
  }

  async reorderEntryInList(
    listId: string,
    candidateId: string,
    toIndex: number,
  ): Promise<void> {
    const current = await this.getList(listId);
    const from = current.entries.indexOf(candidateId);
    if (from === -1) throw new Error("entry not found");
    const clamped = Math.max(0, Math.min(toIndex, current.entries.length - 1));
    const next = [...current.entries];
    next.splice(from, 1);
    next.splice(clamped, 0, candidateId);
    const pool = this.pool;
    if (!pool || typeof (pool as Pool).connect !== "function") {
      throw pgError("failed to reorder entries", new Error("no pool"));
    }
    let client: PoolClient | null = null;
    try {
      client = await (pool as Pool).connect();
      await client.query("BEGIN");
      await client.query("DELETE FROM list_entries WHERE list_id=$1", [listId]);
      for (let i = 0; i < next.length; i++) {
        await client.query(
          "INSERT INTO list_entries (list_id, candidate_id, position) VALUES ($1,$2,$3)",
          [listId, next[i], i],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client?.query("ROLLBACK").catch(() => undefined);
      throw pgError("failed to reorder entries", err);
    } finally {
      client?.release();
    }
  }

  private async normalizePositions(listId: string): Promise<void> {
    const e = await this.q.query(
      "SELECT candidate_id FROM list_entries WHERE list_id=$1 ORDER BY position",
      [listId],
    );
    const ids = (e.rows as unknown as { candidate_id: string }[]).map(
      (r) => r.candidate_id,
    );
    const pool = this.pool;
    if (!pool || typeof (pool as Pool).connect !== "function") return;
    const client = await (pool as Pool).connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM list_entries WHERE list_id=$1", [listId]);
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          "INSERT INTO list_entries (list_id, candidate_id, position) VALUES ($1,$2,$3)",
          [listId, ids[i], i],
        );
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
    } finally {
      client.release();
    }
  }

  async saveAuction(
    name: string,
    sourceListId: string | null,
  ): Promise<AuctionRecord> {
    if (name.length > 200) throw new Error("invalid name");
    const id = randomUUID();
    try {
      await this.q.query(
        "INSERT INTO auctions (id, name, source_list_id, follows_source) VALUES ($1,$2,$3,$4)",
        [id, name, sourceListId, sourceListId !== null],
      );
      if (sourceListId) {
        const src = await this.getList(sourceListId);
        await this.writeAuctionEntries(id, src.entries);
      }
      return await this.getAuction(id);
    } catch (err) {
      if ((err as Error).message === "list not found") throw err;
      throw pgError("failed to save auction", err);
    }
  }

  async listAuctions(): Promise<AuctionRecord[]> {
    try {
      const r = await this.q.query(
        "SELECT id FROM auctions ORDER BY updated_at DESC, created_at DESC",
      );
      const out: AuctionRecord[] = [];
      for (const row of r.rows as unknown as { id: string }[])
        out.push(await this.getAuction(row.id));
      return out;
    } catch (err) {
      throw pgError("failed to list auctions", err);
    }
  }

  async getAuction(id: string): Promise<AuctionRecord> {
    try {
      const r = await this.q.query(
        "SELECT id, name, source_list_id, follows_source, battlefield_id, status FROM auctions WHERE id=$1",
        [id],
      );
      const row = r.rows[0] as unknown as
        | {
            id: string;
            name: string;
            source_list_id: string | null;
            follows_source: boolean;
            battlefield_id: string | null;
            status: string;
          }
        | undefined;
      if (!row) throw new Error("auction not found");
      let entries: string[];
      if (row.follows_source && row.source_list_id) {
        const e = await this.q.query(
          "SELECT candidate_id FROM list_entries WHERE list_id=$1 ORDER BY position",
          [row.source_list_id],
        );
        entries = (e.rows as unknown as { candidate_id: string }[]).map(
          (x) => x.candidate_id,
        );
      } else {
        const e = await this.q.query(
          "SELECT candidate_id FROM auction_entries WHERE auction_id=$1 ORDER BY position",
          [id],
        );
        entries = (e.rows as unknown as { candidate_id: string }[]).map(
          (x) => x.candidate_id,
        );
      }
      return {
        id: row.id,
        name: row.name,
        sourceListId: row.source_list_id,
        followsSource: row.follows_source,
        entries,
        battlefieldId: row.battlefield_id,
        status: row.status,
      };
    } catch (err) {
      if ((err as Error).message === "auction not found") throw err;
      throw pgError("failed to read auction", err);
    }
  }

  private async ensureForked(auctionId: string): Promise<void> {
    const r = await this.q.query(
      "SELECT follows_source, source_list_id FROM auctions WHERE id=$1",
      [auctionId],
    );
    const row = r.rows[0] as unknown as
      | { follows_source: boolean; source_list_id: string | null }
      | undefined;
    if (!row) throw new Error("auction not found");
    if (!row.follows_source) return;
    if (!row.source_list_id) return;
    const src = await this.getList(row.source_list_id);
    await this.writeAuctionEntries(auctionId, src.entries);
    await this.q.query(
      "UPDATE auctions SET follows_source=false, updated_at=now() WHERE id=$1",
      [auctionId],
    );
  }

  private async writeAuctionEntries(
    auctionId: string,
    entries: string[],
  ): Promise<void> {
    const pool = this.pool;
    if (!pool || typeof (pool as Pool).connect !== "function") {
      throw pgError("failed to write auction entries", new Error("no pool"));
    }
    const client = await (pool as Pool).connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM auction_entries WHERE auction_id=$1", [
        auctionId,
      ]);
      for (let i = 0; i < entries.length; i++) {
        await client.query(
          "INSERT INTO auction_entries (auction_id, candidate_id, position) VALUES ($1,$2,$3)",
          [auctionId, entries[i], i],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async renameAuction(id: string, name: string): Promise<AuctionRecord> {
    if (name.length > 200) throw new Error("invalid name");
    try {
      await this.ensureForked(id);
      await this.q.query(
        "UPDATE auctions SET name=$2, updated_at=now() WHERE id=$1",
        [id, name],
      );
      return await this.getAuction(id);
    } catch (err) {
      if ((err as Error).message === "auction not found") throw err;
      if (err instanceof PersistenceError) throw err;
      throw pgError("failed to rename auction", err);
    }
  }

  async setAuctionBattlefield(
    id: string,
    battlefieldId: string | null,
  ): Promise<AuctionRecord> {
    try {
      await this.battlefields.select(id, battlefieldId);
      return await this.getAuction(id);
    } catch (err) {
      if (err instanceof AssetError || err instanceof PersistenceError) throw err;
      throw pgError("failed to update auction", err);
    }
  }

  async addEntryToAuction(
    auctionId: string,
    candidateId: string,
  ): Promise<AuctionRecord> {
    try {
      await this.ensureForked(auctionId);
      const cur = await this.getAuction(auctionId);
      if (cur.entries.includes(candidateId))
        throw new Error("duplicate entry");
      await this.writeAuctionEntries(auctionId, [...cur.entries, candidateId]);
      await this.q.query(
        "UPDATE auctions SET updated_at=now() WHERE id=$1",
        [auctionId],
      );
      return await this.getAuction(auctionId);
    } catch (err) {
      if (
        (err as Error).message === "auction not found" ||
        /duplicate/i.test((err as Error).message)
      )
        throw err;
      if (err instanceof PersistenceError) throw err;
      throw pgError("failed to add auction entry", err);
    }
  }

  async removeEntryFromAuction(
    auctionId: string,
    candidateId: string,
  ): Promise<AuctionRecord> {
    try {
      await this.ensureForked(auctionId);
      const cur = await this.getAuction(auctionId);
      await this.writeAuctionEntries(
        auctionId,
        cur.entries.filter((e) => e !== candidateId),
      );
      await this.q.query(
        "UPDATE auctions SET updated_at=now() WHERE id=$1",
        [auctionId],
      );
      return await this.getAuction(auctionId);
    } catch (err) {
      if (err instanceof PersistenceError) throw err;
      throw pgError("failed to remove auction entry", err);
    }
  }

  async reorderEntryInAuction(
    auctionId: string,
    candidateId: string,
    toIndex: number,
  ): Promise<AuctionRecord> {
    try {
      await this.ensureForked(auctionId);
      const cur = await this.getAuction(auctionId);
      const from = cur.entries.indexOf(candidateId);
      if (from === -1) throw new Error("entry not found");
      const clamped = Math.max(0, Math.min(toIndex, cur.entries.length - 1));
      const next = [...cur.entries];
      next.splice(from, 1);
      next.splice(clamped, 0, candidateId);
      await this.writeAuctionEntries(auctionId, next);
      await this.q.query(
        "UPDATE auctions SET updated_at=now() WHERE id=$1",
        [auctionId],
      );
      return await this.getAuction(auctionId);
    } catch (err) {
      if ((err as Error).message === "entry not found") throw err;
      if (err instanceof PersistenceError) throw err;
      throw pgError("failed to reorder auction entries", err);
    }
  }
}
