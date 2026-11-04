import type { Pool, PoolClient } from "pg";
import type { Response } from "express";
import type { PgStore } from "./store.js";

export function requestStore(res: Response): PgStore {
  if (!res.locals.store) throw new AccessError();
  return res.locals.store as PgStore;
}

export class AccessError extends Error {
  constructor() { super("not found"); this.name = "AccessError"; }
}

// Lock ownership in the same transaction as writes, including live/undo paths.
export async function assertOwnedAuction(client: Pool | PoolClient, id: string, userId: string): Promise<void> {
  if (!userId) throw new AccessError();
  const result = await client.query("SELECT id FROM auctions WHERE id=$1 AND owner_user_id=$2 FOR UPDATE", [id, userId]);
  if (!result.rows[0]) throw new AccessError();
}
