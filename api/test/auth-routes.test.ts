import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { PgStore } from "../src/store.js";
import { AuthStore } from "../src/auth-store.js";
import { hashToken } from "../src/auth-crypto.js";
import { createVerifiedUser } from "./helpers/auth.js";

describe("account HTTP security", () => {
  let admin: Pool, pool: Pool, auth: AuthStore, server: Server, base: string;
  const schema = `auth_http_${randomUUID().replaceAll("-", "")}`;
  const origin = "http://localhost:5173";
  const delivered: { to: string; purpose: string; url: string }[] = [];
  let unavailable = false, rejectDelivery = false;
  beforeAll(async () => {
    const value = process.env.AUTH_TEST_DATABASE_URL;
    if (!value || !/^\/[^/]*(?:test|disposable)[^/]*$/i.test(new URL(value).pathname)) throw new Error("Explicit disposable AUTH_TEST_DATABASE_URL required");
    admin = new Pool({ connectionString: value });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"));
    auth = new AuthStore(pool);
    const app = buildApp(new PgStore(pool), { config: { allowedOrigin: origin, appUrl: origin, production: false, trustedProxies: [] }, mail: {
      async verify() { if (unavailable) throw new Error("private SMTP error"); },
      async sendAccountMail(input) { if (rejectDelivery) throw new Error("private recipient error"); delivered.push(input); },
    } });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(async () => {
    unavailable = false; rejectDelivery = false; delivered.length = 0;
    await pool.query("TRUNCATE auth_tokens,auth_sessions,auth_rate_limits; DELETE FROM app_users WHERE username<>'legacy'");
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  async function client() {
    const cookies = new Map<string, string>(); let csrf = "";
    const request = async (path: string, body?: unknown, extra: Record<string, string> = {}) => {
      const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: {
        Origin: origin, "Content-Type": "application/json", Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join("; "), "X-CSRF-Token": csrf, ...extra,
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(";"); const at = pair.indexOf("="); cookies.set(pair.slice(0,at),pair.slice(at+1)); }
      const view = await response.clone().json().catch(() => null); if (view?.csrfToken) csrf = view.csrfToken;
      return response;
    };
    const bootstrap = await request("/auth/session");
    expect(bootstrap.status).toBe(200); expect(await bootstrap.json()).toMatchObject({ user: null, csrfToken: expect.any(String) });
    return { request, cookies, csrf: () => csrf };
  }
  const token = (purpose: string) => new URL([...delivered].reverse().find(m => m.purpose === purpose)!.url).hash.slice(1).split("=")[1];
  const credentials = { username: "tester", email: "tester@example.test", password: "fixture-password" };

  it("requires anonymous CSRF and exact Origin on every unsafe route", async () => {
    const c = await client();
    for (const path of ["/auth/register", "/auth/login", "/auth/logout", "/auth/reset-password", "/candidates", "/unknown"]) {
      expect((await c.request(path, {}, { Origin: "https://evil.example" })).status).toBe(403);
      expect((await c.request(path, {}, { "X-CSRF-Token": "" })).status).toBe(403);
      expect((await c.request(path, {}, { Origin: "" })).status).toBe(403);
    }
  });
  it("binds CSRF to each authenticated session and never falls back to anonymous CSRF", async () => {
    await createVerifiedUser(pool,"tester");
    const a=await client(), b=await client(); const anonymous=a.csrf();
    for (const c of [a,b]) expect((await c.request("/auth/login",{login:"tester",password:"fixture-password"})).status).toBe(200);
    expect((await a.request("/auth/logout",{}, {"X-CSRF-Token":anonymous})).status).toBe(403);
    expect((await a.request("/auth/logout",{}, {"X-CSRF-Token":b.csrf()})).status).toBe(403);
    expect((await a.request("/auth/logout",{})).status).toBe(204);
    expect((await b.request("/auth/session")).status).toBe(200);
  });
  it("sets production Secure host-only cookies and trusts only explicitly configured proxy IPs", async () => {
    const app = buildApp(new PgStore(pool),{config:{allowedOrigin:"https://example.test",appUrl:"https://example.test",production:true,trustedProxies:["127.0.0.1/32","::ffff:127.0.0.1/128"]},mail:{async verify(){throw new Error("offline");},async sendAccountMail(){throw new Error("offline");}}});
    const extra=app.listen(0); await new Promise<void>(resolve=>extra.once("listening",resolve));
    try {
      const address=`http://127.0.0.1:${(extra.address() as {port:number}).port}`;
      const bootstrap=await fetch(address+"/auth/session",{headers:{Origin:"https://example.test"}});
      const cookies=bootstrap.headers.getSetCookie();
      const anonymous=cookies.find(s=>s.startsWith("__Host-odi_anon_csrf="))!;
      expect(anonymous).toContain("Secure"); expect(anonymous).toContain("HttpOnly"); expect(anonymous).not.toContain("Domain=");
      const {csrfToken}=await bootstrap.json();
      for(let i=0;i<6;i++) {
        const response=await fetch(address+"/auth/forgot-password",{method:"POST",headers:{Origin:"https://example.test","Content-Type":"application/json",Cookie:anonymous.split(";")[0],"X-CSRF-Token":csrfToken,"X-Forwarded-For":`198.51.100.${i}`},body:JSON.stringify({email:`missing${i}@example.test`})});
        // Missing SMTP is checked after budgets, but each explicitly trusted client gets a distinct budget.
        expect(response.status).toBe(503);
      }
      expect((await pool.query("SELECT * FROM auth_rate_limits WHERE attempts>1")).rowCount).toBe(0);
    } finally {await new Promise<void>(resolve=>extra.close(()=>resolve()));}
  });
  it("registers generically, verifies once, logs in with private cookies and logs out", async () => {
    const c = await client();
    const registration = await c.request("/auth/register", credentials);
    expect(registration.status).toBe(202); expect(registration.headers.get("cache-control")).toBe("no-store");
    const raw = token("verify_email");
    expect((await c.request("/auth/register", credentials)).status).toBe(202);
    expect((await c.request("/auth/login", { login: "tester", password: credentials.password })).status).toBe(401);
    expect((await pool.query("SELECT token_hash FROM auth_tokens")).rows.map(r => r.token_hash)).toContain(hashToken(raw));
    expect((await c.request("/auth/verify-email", { token: raw })).status).toBe(204);
    expect((await c.request("/auth/verify-email", { token: raw })).status).toBe(400);
    const login = await c.request("/auth/login", { login: " TESTER@EXAMPLE.TEST ", password: credentials.password });
    expect(login.status).toBe(200); expect(await login.json()).toMatchObject({ user: { username: "tester" }, csrfToken: expect.any(String) });
    const cookie = login.headers.getSetCookie().find(s => s.startsWith("odi_session="))!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Path=/"); expect(cookie).toContain("Max-Age=604800");
    const session = c.cookies.get("odi_session")!;
    expect((await pool.query("SELECT token_hash FROM auth_sessions")).rows[0].token_hash).toBe(hashToken(session));
    expect((await c.request("/auth/session")).headers.get("referrer-policy")).toBe("no-referrer");
    expect((await c.request("/auth/logout", {})).status).toBe(204);
    expect(await auth.resolveSession(session)).toBeNull();
  });
  it("hides missing and incorrect credentials and shares alias failure budgets, ignoring spoofed forwarded IP", async () => {
    await createVerifiedUser(pool, "tester"); const c = await client();
    const missing = await c.request("/auth/login", { login: "missing", password: "wrong-password" });
    const wrong = await c.request("/auth/login", { login: "tester", password: "wrong-password" });
    expect(missing.status).toBe(401); expect(await missing.json()).toEqual(await wrong.json());
    for (let i=0;i<4;i++) expect((await c.request("/auth/login", { login: i%2 ? "tester" : "TESTER@example.test", password: "wrong-password" }, { "X-Forwarded-For": `198.51.100.${i}` })).status).toBe(401);
    expect((await c.request("/auth/login", { login: "tester@example.test", password: "fixture-password" })).status).toBe(429);
    await pool.query("TRUNCATE auth_rate_limits");
    for (let i=0;i<20;i++) expect((await c.request("/auth/login", { login: `unknown${i}`, password: "wrong-password" }, { "X-Forwarded-For": `198.51.100.${i}` })).status).toBe(401);
    expect((await c.request("/auth/login", { login: "another", password: "wrong-password" })).status).toBe(429);
  });
  it("uses fixed frontend token links, rejects expiry and concurrent reuse, resets all sessions", async () => {
    const user = await createVerifiedUser(pool, "tester"); const c = await client();
    const sessions = await Promise.all([auth.createSession(user.id), auth.createSession(user.id)]);
    expect((await c.request("/auth/forgot-password", { email: user.email }, { Host: "evil.example" })).status).toBe(202);
    expect(delivered[0].url).toMatch(/^http:\/\/localhost:5173\/account\/reset-password#token=/);
    let raw = token("reset_password");
    await pool.query("UPDATE auth_tokens SET expires_at=now()-interval '1 second'");
    expect((await c.request("/auth/reset-password", { token: raw, password: "replacement-password" })).status).toBe(400);
    await c.request("/auth/forgot-password", { email: user.email }); raw = token("reset_password");
    const results = await Promise.all([c.request("/auth/reset-password", { token: raw, password: "replacement-password" }), c.request("/auth/reset-password", { token: raw, password: "replacement-password" })]);
    expect(results.map(r=>r.status).sort()).toEqual([204,400]);
    for (const s of sessions) expect(await auth.resolveSession(s.token)).toBeNull();
    expect(await auth.verifyLocalUser("tester", "replacement-password")).not.toBeNull();
    await c.request("/auth/register", { ...credentials, username: "pending", email: "pending@example.test" });
    raw = token("verify_email");
    const verification = await Promise.all([c.request("/auth/verify-email", {token:raw}),c.request("/auth/verify-email", {token:raw})]);
    expect(verification.map(r=>r.status).sort()).toEqual([204,400]);
  });
  it("preflights unavailable mail before account lookup, rolls back failed delivery and supports retry", async () => {
    const c = await client(); unavailable = true;
    for (const path of ["/auth/register", "/auth/forgot-password", "/auth/resend-verification"]) {
      const response = await c.request(path, credentials); expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("SMTP");
    }
    expect((await pool.query("SELECT id FROM app_users WHERE username='tester'")).rowCount).toBe(0);
    unavailable = false; rejectDelivery = true;
    expect((await c.request("/auth/register", credentials)).status).toBe(503);
    expect((await pool.query("SELECT id FROM app_users WHERE username='tester'")).rowCount).toBe(0);
    rejectDelivery = false; expect((await c.request("/auth/register", credentials)).status).toBe(202);
  });
  it("does not reveal recovery account existence through recipient rejection", async () => {
    await createVerifiedUser(pool,"tester"); const c = await client(); rejectDelivery = true;
    for (const path of ["/auth/forgot-password","/auth/resend-verification"]) {
      const known = await c.request(path,{email:"tester@example.test"});
      const unknown = await c.request(path,{email:"missing@example.test"});
      expect(known.status).toBe(503); expect(unknown.status).toBe(503);
      expect(await known.json()).toEqual(await unknown.json());
    }
    expect((await pool.query("SELECT * FROM auth_tokens")).rowCount).toBe(0);
  });
  it("resends verification without leaking an existing account and rejects expired verification links",async()=>{
    const c=await client(); await c.request("/auth/register",credentials);
    await c.request("/auth/resend-verification",{email:credentials.email});
    const raw=token("verify_email");
    const missing=await c.request("/auth/resend-verification",{email:"missing@example.test"});
    expect(missing.status).toBe(202); expect(await missing.json()).toEqual({ok:true});
    await pool.query("UPDATE auth_tokens SET expires_at=now()-interval '1 second'");
    expect((await c.request("/auth/verify-email",{token:raw})).status).toBe(400);
    await c.request("/auth/resend-verification",{email:credentials.email});
    expect((await c.request("/auth/verify-email",{token:token("verify_email")})).status).toBe(204);
  });
  it("rejects email address-list/header injection before delivery",async()=>{
    const c=await client();
    for (const email of ["tester@example.test,other", "<tester@example.test>", "tester@example.test\r\nBcc:other"]) {
      expect((await c.request("/auth/register",{...credentials,email})).status).toBe(400);
      expect((await c.request("/auth/forgot-password",{email})).status).toBe(400);
    }
    expect(delivered).toHaveLength(0);
  });
  it("redacts malformed account JSON rather than reflecting credential fragments",async()=>{
    const c=await client();
    const response=await fetch(base+"/auth/login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json","X-CSRF-Token":c.csrf(),Cookie:[...c.cookies].map(([k,v])=>`${k}=${v}`).join("; ")},body:'{"password":"private-sentinel", INVALID'});
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("private-sentinel");
  });
  it("rate limits registration/recovery/resend by account and IP", async () => {
    const c = await client();
    for (const path of ["/auth/register", "/auth/forgot-password", "/auth/resend-verification"]) {
      await pool.query("TRUNCATE auth_rate_limits");
      for (let i=0;i<5;i++) expect((await c.request(path, credentials)).status).toBe(202);
      expect((await c.request(path, credentials)).status).toBe(429);
    }
  });
});
