import { generateKeyPairSync, randomUUID, sign, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadAuthConfig } from "../src/auth-config.js";
import { PgStore } from "../src/store.js";
import { createVerifiedUser } from "./helpers/auth.js";
import { AuthStore } from "../src/auth-store.js";

describe("Google OIDC protocol and linking", () => {
  const schema = `google_test_${randomUUID().replaceAll("-", "")}`;
  const origin = "http://localhost:5173", redirectUri = "http://localhost:3001/auth/google/callback";
  const google = { clientId: "protocol-test-client", clientSecret: "protocol-test-only", redirectUri, stateEncryptionKey: Buffer.alloc(32, 7).toString("base64") };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
  const realFetch = globalThis.fetch;
  let pool: Pool, admin: Pool, server: Server, base: string;
  let claims: Record<string, unknown>, failPkce: boolean, badSignature: boolean, userinfoSubject: string;
  let tokenGate: (() => Promise<void>) | undefined;
  const codes = new Map<string, URL>();
  beforeAll(async () => {
    const value = process.env.AUTH_TEST_DATABASE_URL;
    if (!value || !/^\/[^/]*(?:test|disposable)[^/]*$/i.test(new URL(value).pathname)) throw new Error("Explicit disposable AUTH_TEST_DATABASE_URL required");
    admin = new Pool({ connectionString: value }); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString(), max: 4, application_name: schema });
    await pool.query(await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"));
    const app = buildApp(new PgStore(pool), { config: { allowedOrigin: origin, appUrl: origin, production: false, trustedProxies: [], google } });
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!["accounts.google.com", "oauth2.googleapis.com", "openidconnect.googleapis.com"].includes(url.hostname)) return realFetch(input, init);
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
      if (url.pathname.includes("openid-configuration")) return json({ issuer: "https://accounts.google.com", authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://oauth2.googleapis.com/token", jwks_uri: "https://accounts.google.com/jwks", userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo", response_types_supported: ["code"], id_token_signing_alg_values_supported: ["RS256"] });
      if (url.pathname === "/jwks") return json({ keys: [jwk] });
      if (url.pathname === "/v1/userinfo") return json({ sub: userinfoSubject, email: claims.email ?? "google@example.test", email_verified: claims.email_verified ?? true });
      if (url.pathname === "/token") {
        await tokenGate?.();
        const body = new URLSearchParams(String(init?.body)), start = codes.get(body.get("code") ?? "");
        const challenge = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
        if (failPkce || !start || challenge !== start.searchParams.get("code_challenge")) return json({ error: "invalid_grant" }, 400);
        const now = Math.floor(Date.now()/1000);
        const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
        const payload = `${encode({ alg: "RS256", kid: "test-key" })}.${encode({ iss: "https://accounts.google.com", aud: google.clientId, sub: "subject-1", iat: now, exp: now+300, nonce: start.searchParams.get("nonce"), email: "google@example.test", email_verified: true, ...claims })}`;
        const signature = sign("RSA-SHA256", Buffer.from(payload), privateKey);
        if (badSignature) signature[0] ^= 1;
        return json({ access_token: "ephemeral-test-token", token_type: "Bearer", expires_in: 300, id_token: `${payload}.${signature.toString("base64url")}` });
      }
      throw new Error("Unexpected protocol request");
    });
  });
  beforeEach(async () => {
    claims = {}; failPkce = false; badSignature = false; userinfoSubject = "subject-1"; codes.clear();
    tokenGate = undefined;
    await pool.query("TRUNCATE auth_tokens,auth_sessions,auth_rate_limits; DELETE FROM app_users WHERE username<>'legacy'");
    if ((await pool.query("SELECT to_regclass('auth_oauth_states') AS table_name")).rows[0].table_name) await pool.query("DELETE FROM auth_oauth_states");
  });
  afterAll(async () => {
    vi.unstubAllGlobals(); await new Promise<void>(resolve => server?.close(() => resolve()));
    await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  async function browser() {
    const cookies = new Map<string,string>(); let csrf = "";
    const request = async (path: string, body?: unknown, headers: Record<string,string> = {}) => {
      const response = await fetch(base+path, { method: body === undefined ? "GET" : "POST", redirect: "manual", headers: { Origin: origin, Cookie: [...cookies].map(([k,v])=>`${k}=${v}`).join("; "), "Content-Type": "application/json", "X-CSRF-Token": csrf, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      for (const item of response.headers.getSetCookie()) { const pair=item.split(";")[0], at=pair.indexOf("="); cookies.set(pair.slice(0,at),pair.slice(at+1)); }
      const view = await response.clone().json().catch(()=>null); if (view?.csrfToken) csrf=view.csrfToken;
      return response;
    };
    await request("/auth/session");
    const start = async (link = false, path = "") => {
      const response = await request(link ? "/auth/google/link" : "/auth/google/start"+path, link ? {} : undefined);
      expect(response.status).toBe(link ? 200 : 302);
      const url = new URL(link ? (await response.json()).url : response.headers.get("location")!);
      const code=randomUUID(); codes.set(code,url);
      return { url, callback: `/auth/google/callback?code=${code}&state=${url.searchParams.get("state")}` };
    };
    return { request, start, cookies };
  }
  async function count(table: string) { return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count); }
  function expectGoogleError(response: Response, reason: "invalid" | "link_required" | "unavailable") {
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${origin}/account?google=${reason}`);
  }
  it("advertises validated configuration without discovery or secrets", async () => {
    const b=await browser(); expect(await (await b.request("/auth/session")).json()).toMatchObject({googleEnabled:true,user:null});
    expect(()=>loadAuthConfig({ GOOGLE_CLIENT_ID:"incomplete" })).toThrow();
    expect(()=>loadAuthConfig({GOOGLE_CLIENT_ID:"id",GOOGLE_CLIENT_SECRET:"secret",GOOGLE_REDIRECT_URI:"https://evil.test/wrong",AUTH_STATE_ENCRYPTION_KEY:"bad"})).toThrow();
  });
  it("logs in with signed verified claims, encrypted PKCE and hash-only state, then rejects replay", async () => {
    const b=await browser(), flow=await b.start();
    expect(flow.url.searchParams.get("scope")).toBe("openid email profile");
    expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256");
    const row=(await pool.query("SELECT * FROM auth_oauth_states")).rows[0];
    expect(JSON.stringify(row)).not.toContain(flow.url.searchParams.get("state"));
    expect(row.verifier_ciphertext).not.toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await b.request(flow.callback)).status).toBe(302);
    expect(await (await b.request("/auth/session")).json()).toMatchObject({user:{email:"google@example.test"}});
    expectGoogleError(await b.request(flow.callback),"invalid");
    expect(await count("auth_sessions")).toBe(1); expect(await count("auth_google_identities")).toBe(1); expect(await count("auth_oauth_states")).toBe(0);
    expect(JSON.stringify((await pool.query("SELECT * FROM auth_google_identities")).rows)).not.toContain("ephemeral-test-token");
  });
  it.each(["issuer","audience","signature","nonce","expired-token","pkce","unverified","missing-email","userinfo-subject"])("rejects invalid %s without identity or session", async mode => {
    if(mode==="issuer") claims.iss="https://evil.test";
    if(mode==="audience") claims.aud="other";
    if(mode==="signature") badSignature=true;
    if(mode==="nonce") claims.nonce="wrong";
    if(mode==="expired-token") claims.exp=1;
    if(mode==="pkce") failPkce=true;
    if(mode==="unverified") claims.email_verified=false;
    if(mode==="missing-email") claims.email=null;
    if(mode==="userinfo-subject") userinfoSubject="other";
    const b=await browser(), flow=await b.start(); expectGoogleError(await b.request(flow.callback),"invalid");
    expect(await count("auth_sessions")).toBe(0); expect(await count("auth_google_identities")).toBe(0); expect(await count("auth_oauth_states")).toBe(0);
  });
  it("rejects expired and browser-unbound state and concurrent callback consumption", async () => {
    const a=await browser(), b=await browser(), first=await a.start();
    expectGoogleError(await b.request(first.callback),"invalid");
    await pool.query("UPDATE auth_oauth_states SET expires_at=now()-interval '1 second'");
    expectGoogleError(await a.request(first.callback),"invalid"); expect(await count("auth_oauth_states")).toBe(0);
    const flow=await a.start(); const responses=await Promise.all([a.request(flow.callback),a.request(flow.callback)]);
    expect(responses.filter(r=>r.headers.get("location") === origin+"/app")).toHaveLength(1);
    expectGoogleError(responses.find(r=>r.headers.get("location") !== origin+"/app")!,"invalid"); expect(await count("auth_sessions")).toBe(1);
  });
  it("refuses matching-email takeover and generates different valid usernames", async () => {
    await createVerifiedUser(pool,"google");
    const b=await browser(), first=await b.start(); expectGoogleError(await b.request(first.callback),"link_required");
    expect(await count("auth_google_identities")).toBe(0);
    claims.email="one@example.test"; const second=await b.start(); expect((await b.request(second.callback)).status).toBe(302);
    await b.request("/auth/session"); await b.request("/auth/logout",{}); claims={email:"two@example.test",sub:"subject-2"}; userinfoSubject="subject-2";
    const third=await b.start(); expect((await b.request(third.callback)).status).toBe(302);
    const users=(await pool.query("SELECT username FROM app_users WHERE username<>'legacy'")).rows.map(r=>r.username);
    expect(new Set(users).size).toBe(3); for(const username of users) expect(username).toMatch(/^[a-z0-9_]{3,32}$/);
  });
  it.each([
    {email:"owner@gmail.com"},
    {email:"owner@workspace.test",hd:"workspace.test"},
  ])("automatically links authoritative Google email $email to the existing verified account", async identity => {
    const user=await createVerifiedUser(pool,"owner");
    await pool.query("UPDATE app_users SET email=$1 WHERE id=$2",[identity.email,user.id]);
    claims=identity;
    const b=await browser(), flow=await b.start();
    const response=await b.request(flow.callback);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(origin+"/app");
    expect(await (await b.request("/auth/session")).json()).toMatchObject({user:{id:user.id}});
    expect((await pool.query("SELECT user_id FROM auth_google_identities")).rows).toEqual([{user_id:user.id}]);
    expect(await count("app_users")).toBe(2);
  });
  it.each(["disabled", "unverified", "already-linked"])("does not automatically claim a %s account", async mode => {
    const user=await createVerifiedUser(pool,"owner");
    await pool.query("UPDATE app_users SET email='owner@gmail.com' WHERE id=$1",[user.id]);
    if (mode === "disabled") await pool.query("UPDATE app_users SET disabled_at=now() WHERE id=$1",[user.id]);
    if (mode === "unverified") await pool.query("UPDATE app_users SET email_verified_at=NULL WHERE id=$1",[user.id]);
    if (mode === "already-linked") await pool.query("INSERT INTO auth_google_identities (issuer,subject,user_id) VALUES ('https://accounts.google.com','another-subject',$1)",[user.id]);
    claims={email:"owner@gmail.com"};
    const b=await browser(), flow=await b.start();
    expectGoogleError(await b.request(flow.callback),mode === "already-linked" ? "link_required" : "unavailable");
    expect(await count("auth_sessions")).toBe(0);
    expect(await count("auth_google_identities")).toBe(mode === "already-linked" ? 1 : 0);
  });
  it("requires authenticated CSRF and recent password reauthentication bound to the exact session for linking", async () => {
    await createVerifiedUser(pool,"local"); const a=await browser(), b=await browser();
    expect((await a.request("/auth/google/link",{})).status).toBe(401);
    for(const c of [a,b]) expect((await c.request("/auth/login",{login:"local",password:"fixture-password"})).status).toBe(200);
    expect((await a.request("/auth/google/link",{})).status).toBe(403);
    expect((await a.request("/auth/reauthenticate",{password:"wrong"})).status).toBe(401);
    expect((await a.request("/auth/reauthenticate",{password:"fixture-password"})).status).toBe(204);
    expect((await a.request("/auth/google/link",{}, {"X-CSRF-Token":""})).status).toBe(403);
    const flow=await a.start(true); b.cookies.set("odi_google_tx",a.cookies.get("odi_google_tx")!);
    expectGoogleError(await b.request(flow.callback),"invalid");
    const next=await a.start(true); expect((await a.request(next.callback)).status).toBe(302);
    expect((await pool.query("SELECT user_id FROM auth_google_identities")).rows[0].user_id).toBe((await pool.query("SELECT id FROM app_users WHERE username='local'")).rows[0].id);
    await pool.query("UPDATE auth_sessions SET reauthenticated_at=now()-interval '6 minutes'");
    expect((await a.request("/auth/google/link",{})).status).toBe(403);
  });
  it("rechecks reauthentication and session revocation at callback and never redirects off-site", async () => {
    await createVerifiedUser(pool,"local"); const b=await browser();
    await b.request("/auth/login",{login:"local",password:"fixture-password"}); await b.request("/auth/reauthenticate",{password:"fixture-password"});
    const flow=await b.start(true); await pool.query("UPDATE auth_sessions SET reauthenticated_at=now()-interval '6 minutes'");
    expectGoogleError(await b.request(flow.callback),"unavailable");
    await b.request("/auth/reauthenticate",{password:"fixture-password"}); const next=await b.start(true); await b.request("/auth/logout",{});
    expectGoogleError(await b.request(next.callback),"invalid"); expect(await count("auth_google_identities")).toBe(0);
    const login=await b.start(false,"?returnTo=https://evil.test"); expect((await b.request(login.callback)).headers.get("location")).toBe(origin+"/app");
  });
  it("fails closed for malformed, unknown, duplicated state/cookies and encrypted verifier tampering", async () => {
    const b=await browser(), flow=await b.start();
    for (const query of ["state=bad",`state=${"x".repeat(43)}`,`state=${flow.url.searchParams.get("state")}&state=duplicate`]) {
      expectGoogleError(await b.request("/auth/google/callback?code=unused&"+query),"invalid");
    }
    const value=b.cookies.get("odi_google_tx");
    expectGoogleError(await b.request(flow.callback,undefined,{Cookie:`odi_google_tx=${value}; odi_google_tx=${value}`}),"invalid");
    const row=(await pool.query("SELECT verifier_ciphertext FROM auth_oauth_states")).rows[0];
    const bytes=Buffer.from(row.verifier_ciphertext,"base64url"); bytes[30]^=1;
    await pool.query("UPDATE auth_oauth_states SET verifier_ciphertext=$1",[bytes.toString("base64url")]);
    expectGoogleError(await b.request(flow.callback),"invalid"); expect(await count("auth_sessions")).toBe(0);
  });
  it("uses immutable issuer/subject on repeat sign-in, rejects disabled users and never asks for offline tokens", async () => {
    const b=await browser(), first=await b.start();
    expect(first.url.searchParams.has("access_type")).toBe(false);
    await b.request(first.callback); await b.request("/auth/session"); await b.request("/auth/logout",{});
    const id=(await pool.query("SELECT user_id FROM auth_google_identities")).rows[0].user_id;
    claims.email="changed@example.test";
    const next=await b.start(); expect((await b.request(next.callback)).status).toBe(302);
    expect((await pool.query("SELECT user_id FROM auth_google_identities")).rows[0].user_id).toBe(id);
    await b.request("/auth/session"); await b.request("/auth/logout",{});
    await pool.query("UPDATE app_users SET disabled_at=now() WHERE id=$1",[id]);
    const disabled=await b.start(); expectGoogleError(await b.request(disabled.callback),"unavailable");
    expect(await count("auth_google_identities")).toBe(1);
  });
  it("cannot link another user's Google identity or replace an existing link", async () => {
    const b=await browser(), googleFlow=await b.start(); await b.request(googleFlow.callback);
    await b.request("/auth/session"); await b.request("/auth/logout",{});
    await createVerifiedUser(pool,"local"); await b.request("/auth/session");
    expect((await b.request("/auth/login",{login:"local",password:"fixture-password"})).status).toBe(200);
    expect((await b.request("/auth/google/start")).status).toBe(409);
    await b.request("/auth/reauthenticate",{password:"fixture-password"});
    const conflict=await b.start(true); expectGoogleError(await b.request(conflict.callback),"link_required");
    claims.sub="subject-2"; userinfoSubject="subject-2";
    const linked=await b.start(true); expect((await b.request(linked.callback)).status).toBe(302);
    claims.sub="subject-3"; userinfoSubject="subject-3";
    const replacement=await b.start(true); expectGoogleError(await b.request(replacement.callback),"link_required");
    expect(await count("auth_google_identities")).toBe(2);
  });
  it("serializes simultaneous competing links to the same issuer/subject", async () => {
    const browsers = await Promise.all([browser(), browser()]);
    for (const [i, b] of browsers.entries()) {
      await createVerifiedUser(pool, `competitor_${i}`);
      await b.request("/auth/login", { login: `competitor_${i}`, password: "fixture-password" });
      await b.request("/auth/reauthenticate", { password: "fixture-password" });
    }
    const flows = await Promise.all(browsers.map(b => b.start(true)));
    let arrived = 0, release!: () => void;
    const both = new Promise<void>(resolve => { release = resolve; });
    tokenGate = async () => { if (++arrived === 2) release(); await both; };
    const responses = await Promise.all(browsers.map((b, i) => b.request(flows[i].callback)));
    expect(responses.filter(r=>r.headers.get("location") === origin+"/app")).toHaveLength(1);
    expectGoogleError(responses.find(r=>r.headers.get("location") !== origin+"/app")!,"link_required");
    expect(await count("auth_google_identities")).toBe(1);
  });
  it.each(["reset", "logout"])("callback rechecks session locks after concurrent %s during exchange", async mode => {
    const user = await createVerifiedUser(pool, "racing_local");
    const b = await browser();
    await b.request("/auth/login", { login: user.username, password: "fixture-password" });
    await b.request("/auth/reauthenticate", { password: "fixture-password" });
    const flow = await b.start(true);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    tokenGate = async () => { entered(); await gate; };
    const callback = b.request(flow.callback);
    try {
      await started;
      if (mode === "logout") expect((await b.request("/auth/logout", {})).status).toBe(204);
      else {
        const auth = new AuthStore(pool);
        const { token } = await auth.createOneTimeToken(user.id, "reset_password");
        expect(await auth.consumePasswordResetToken(token, "replacement-password")).toBe(true);
      }
    } finally { release(); }
    expectGoogleError(await callback,"unavailable");
    expect(await count("auth_google_identities")).toBe(0);
    expect(await count("auth_sessions")).toBe(0);
  });
  it.each(["reset", "logout"])("callback finalization serializes behind an already-waiting %s lock", async mode => {
    const user = await createVerifiedUser(pool, "locked_local"), auth = new AuthStore(pool);
    const session = await auth.authenticateLocalUser(user.username, "fixture-password");
    expect(session).not.toBeNull();
    await auth.reauthenticateLocalSession(session!.token, "fixture-password", "local");
    const reset = await auth.createOneTimeToken(user.id, "reset_password");
    const blocker = await pool.connect();
    let revoke: Promise<unknown> | undefined, finish: Promise<unknown> | undefined;
    const waitForLocks = async (minimum: number) => {
      for (let i=0;i<200;i++) {
        const result = await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND (query LIKE '%auth_sessions%' OR query LIKE '%app_users%')", [schema]);
        if (result.rows[0].n >= minimum) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Expected finalization/revocation lock wait");
    };
    try {
      await blocker.query("BEGIN");
      await blocker.query(mode === "reset" ? "SELECT id FROM app_users WHERE id=$1 FOR UPDATE" : "SELECT id FROM auth_sessions WHERE user_id=$1 FOR UPDATE", [user.id]);
      revoke = mode === "reset" ? auth.consumePasswordResetToken(reset.token, "replacement-password") : auth.revokeSession(session!.token);
      await waitForLocks(1);
      finish = auth.finishGoogleIdentity({issuer:"https://accounts.google.com",subject:"locked-subject",email:"google@example.test"}, {userId:user.id,sessionHash:createHash("sha256").update(session!.token).digest("hex")});
      await waitForLocks(2);
      await blocker.query("COMMIT");
      await revoke;
      expect(await finish).toEqual({status:403});
      expect(await count("auth_google_identities")).toBe(0);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await revoke; await finish; }
  });
  it("shares failed reauthentication budgets with local login and rate-limits Google starts", async () => {
    await createVerifiedUser(pool,"local"); const b=await browser();
    await b.request("/auth/login",{login:"local",password:"fixture-password"});
    for(let i=0;i<5;i++) expect((await b.request("/auth/reauthenticate",{password:"wrong"})).status).toBe(401);
    expect((await b.request("/auth/reauthenticate",{password:"fixture-password"})).status).toBe(429);
    expect((await b.request("/auth/login",{login:"local@example.test",password:"fixture-password"})).status).toBe(429);
    await b.request("/auth/logout",{});
    for(let i=0;i<20;i++) expect((await b.request("/auth/google/start")).status).toBe(302);
    const response=await b.request("/auth/google/start"); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("900");
  });
});
