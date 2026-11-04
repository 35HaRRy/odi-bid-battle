import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PgStore } from "../../src/store.js";
import { authenticatedClient, createVerifiedUser } from "./auth.js";

export const fixtureOrigin = "http://localhost:5173";

export async function ownedStore(url: string): Promise<PgStore> {
  const root = await PgStore.connect(url);
  const user = await createVerifiedUser(root.pool!, `u_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  return root.forUser(user.id);
}

export async function fixtureClient(base: string, store: PgStore) {
  const result = await (store.pool as Pool).query<{ username: string }>("SELECT username FROM app_users WHERE id=$1", [store.userId]);
  return authenticatedClient(base, { login: result.rows[0].username, password: "fixture-password" }, fixtureOrigin);
}

// Keep legacy URL-shaped HTTP tests while using actual cookies/CSRF/login.
export async function fixtureFetch(base: string, store: PgStore) {
  const request = await fixtureClient(base, store);
  return (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(base).origin) throw new Error("Fixture origin mismatch");
    return request(parsed.pathname + parsed.search, init);
  };
}
