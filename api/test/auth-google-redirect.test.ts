import express from "express";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { AuthStore } from "../src/auth-store.js";
import { mountGoogleAuth } from "../src/auth-google.js";

const pool = new Pool();
const auth = new AuthStore(pool);
let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  mountGoogleAuth(app, auth, {
    allowedOrigin: "http://localhost:5173", appUrl: "http://localhost:5173", production: false, trustedProxies: [],
    clientId: "test", clientSecret: "test", redirectUri: "http://localhost:3001/auth/google/callback",
    stateEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
});

it.each(["", "?state=invalid&code=private", "?error=access_denied&state=invalid"])("returns invalid callbacks to the frontend without provider data: %s", async query => {
  const response = await fetch(base + "/auth/google/callback" + query, { redirect: "manual" });
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("http://localhost:5173/account?google=invalid");
});

it("returns persistence failures to the frontend rather than JSON or an Express error page", async () => {
  vi.spyOn(auth, "consumeOAuthState").mockRejectedValueOnce(new Error("private database details"));
  const response = await fetch(base + "/auth/google/callback?state=" + "x".repeat(43), {
    redirect: "manual", headers: { Cookie: "odi_google_tx=" + "y".repeat(43) },
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("http://localhost:5173/account?google=unavailable");
});
