import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

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

export interface CandidateListRecord {
  id: string;
  name: string;
  isDraft: boolean;
  entries: string[];
}

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

function pgError(message: string, cause: unknown): PersistenceError {
  return new PersistenceError(message, { cause });
}

export class PgStore {
  private pool: Pool | null;
  private q: Queryable;

  constructor(pool: Queryable & { end?: () => Promise<void> }) {
    this.q = pool;
    this.pool = pool as Pool;
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
    await this.pool?.end().catch(() => undefined);
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
        "SELECT id FROM candidate_lists ORDER BY created_at",
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
        "SELECT id, name, is_draft FROM candidate_lists WHERE id=$1",
        [id],
      );
      const head = l.rows[0] as unknown as
        | { id: string; name: string; is_draft: boolean }
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
        entries: (e.rows as unknown as { candidate_id: string }[]).map(
          (r) => r.candidate_id,
        ),
      };
    } catch (err) {
      if ((err as Error).message === "list not found") throw err;
      throw pgError("failed to read list", err);
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
}
