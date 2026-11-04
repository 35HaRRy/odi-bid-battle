import type { Pool, PoolClient } from "pg";
import type { Response } from "express";
import type { PgStore } from "./store.js";

export interface Visibility { ownerUserId: string; isOwner: boolean; isPublic: boolean }
export type CandidateContext = { listId: string; auctionId?: never } | { auctionId: string; listId?: never };

export function visibility(row: { owner_user_id: string; is_public: boolean }, userId: string): Visibility {
  return { ownerUserId: row.owner_user_id, isOwner: row.owner_user_id === userId, isPublic: row.is_public };
}

// Multipart fields are strings; JSON checkboxes are booleans. Never use truthiness.
export function publicFlag(value: unknown): boolean | undefined {
  return value === undefined ? undefined : value === true || value === "true";
}

export function candidateContext(query: Record<string, unknown>): CandidateContext | undefined {
  const { listId, auctionId } = query;
  if (listId === undefined && auctionId === undefined) return undefined;
  if (typeof listId === "string" && listId && auctionId === undefined) return { listId };
  if (typeof auctionId === "string" && auctionId && listId === undefined) return { auctionId };
  throw new Error("invalid candidate context");
}

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
