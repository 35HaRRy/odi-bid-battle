import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

// Task 2 replaces this structural fixture type with the production AuthUser export.
export type AuthUser = { id: string; username: string; email: string };

export async function createVerifiedUser(pool: Pool, username: string): Promise<AuthUser> {
  const user = { id: randomUUID(), username, email: `${username}@example.test` };
  // shortcut: passwordless fixture until Task 2 exposes its real password hasher.
  await pool.query(`INSERT INTO app_users (id,username,email,email_verified_at)
    VALUES ($1,$2,$3,now())`, [user.id, user.username, user.email]);
  return user;
}

export async function authenticatedClient(
  base: string,
  credentials: { login: string; password: string },
): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  const origin = new URL(base).origin;
  const cookies = new Map<string, string>();
  let csrfToken: string;
  const request = async (path: string, init: RequestInit = {}) => {
    const url = new URL(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
    if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//") || url.origin !== origin) {
      throw new Error("Authenticated fixture only accepts same-origin paths");
    }
    const headers = new Headers(init.headers);
    headers.set("Origin", origin);
    if (cookies.size) headers.set("Cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    const response = await fetch(url, { ...init, headers, redirect: "error" });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const equals = pair.indexOf("=");
      cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    return response;
  };
  const response = await request("/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials),
  });
  if (!response.ok) throw new Error(`Fixture login failed (${response.status})`);
  const session: { csrfToken?: string } = await response.json();
  if (!session.csrfToken || !cookies.size) throw new Error("Fixture login did not return a session and CSRF token");
  csrfToken = session.csrfToken;
  return request;
}
