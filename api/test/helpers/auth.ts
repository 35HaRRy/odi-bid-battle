import type { Pool } from "pg";
import { AuthStore, type AuthUser } from "../../src/auth-store.js";
export type { AuthUser } from "../../src/auth-store.js";

export async function createVerifiedUser(pool: Pool, username: string): Promise<AuthUser> {
  const user = await new AuthStore(pool).createLocalUser({ username, email: `${username}@example.test`, password: "fixture-password" });
  await pool.query("UPDATE app_users SET email_verified_at=now() WHERE id=$1", [user.id]);
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
