import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "../src/auth-crypto.js";
import { AuthStore, AUTH_RATE_LIMITS, authRateLimitKey } from "../src/auth-store.js";
import { hashToken, verifyPassword } from "../src/auth-crypto.js";
import { createVerifiedUser } from "./helpers/auth.js";

describe("authentication persistence", () => {
  let admin: Pool;
  let pool: Pool;
  let store: AuthStore;
  const schema = `auth_store_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    const value = process.env.AUTH_TEST_DATABASE_URL;
    if (!value || !/^\/[^/]*(?:test|disposable)[^/]*$/i.test(new URL(value).pathname)) throw new Error("Explicit disposable AUTH_TEST_DATABASE_URL required");
    admin = new Pool({ connectionString: value });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(value);
    url.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString(), max: 2, application_name: schema });
    await pool.query(await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"));
    store = new AuthStore(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE auth_tokens, auth_sessions, auth_rate_limits; DELETE FROM app_users WHERE username <> 'legacy'"); });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  it("normalizes unique identities without exposing passwords and fixtures can log in", async () => {
    const user = await store.createLocalUser({ username: "  TEST_User ", email: " Test@Example.test ", password: "fixture-password" });
    expect(user).toMatchObject({ username: "test_user", email: "test@example.test" });
    expect(user).not.toHaveProperty("password_hash");
    const row = (await pool.query("SELECT * FROM app_users WHERE id=$1", [user.id])).rows[0];
    expect(await verifyPassword("fixture-password", row.password_hash)).toBe(true);
    await expect(store.createLocalUser({ username: "test_user", email: "other@example.test", password: "fixture-password" })).rejects.toThrow();
    for (const username of ["legacy", "ab", "a@b", "has-dash", "x".repeat(33)]) {
      await expect(store.createLocalUser({ username, email: "other@example.test", password: "fixture-password" })).rejects.toThrow();
    }
    const fixture = await createVerifiedUser(pool, "fixture");
    expect(await store.verifyLocalUser(" FIXTURE ", "fixture-password")).toEqual(fixture);
    expect(await store.verifyLocalUser("fixture@example.test", "fixture-password")).toEqual(fixture);
    expect(await store.verifyLocalUser("fixture", "wrong-password")).toBeNull();
    expect(await store.verifyLocalUser("unknown", "wrong-password")).toBeNull();
  });

  it("session_stores_only_hashes_and_expires_at_7_days", async () => {
    const user = await createVerifiedUser(pool, "tester");
    const start = Date.now();
    const session = await store.createSession(user.id);
    expect(session.expiresAt.getTime() - start).toBeGreaterThanOrEqual(7 * 86400000 - 1000);
    expect(session.expiresAt.getTime() - start).toBeLessThan(7 * 86400000 + 1000);
    const row = (await pool.query("SELECT * FROM auth_sessions")).rows[0];
    expect(row.token_hash).toBe(hashToken(session.token));
    expect(row.csrf_hash).toBe(hashToken(session.csrfToken));
    expect(JSON.stringify(row)).not.toContain(session.token);
    expect(await store.resolveSession(session.token)).toEqual(user);
    expect(await store.verifySessionCsrf(session.token, session.csrfToken)).toBe(true);
    expect(await store.verifySessionCsrf(session.token, "wrong")).toBe(false);
    await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second'");
    expect(await store.resolveSession(session.token)).toBeNull();
    const next = await store.createSession(user.id);
    await store.revokeSession(next.token);
    expect(await store.resolveSession(next.token)).toBeNull();
  });

  it("does not issue a session with credentials read before a concurrent password reset", async () => {
    const user = await createVerifiedUser(pool, "racer");
    const reset = await store.createOneTimeToken(user.id, "reset_password");
    const original = crypto.verifyPassword;
    let reached!: () => void, resume!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const release = new Promise<void>(resolve => { resume = resolve; });
    const spy = vi.spyOn(crypto, "verifyPassword").mockImplementationOnce(async (password, hash) => {
      const valid = await original(password, hash); reached(); await release; return valid;
    });
    try {
      const login = store.authenticateLocalUser("racer", "fixture-password");
      await waiting;
      expect(await store.consumePasswordResetToken(reset.token, "replacement-password")).toBe(true);
      resume(); expect((await login) === null).toBe(true);
      expect((await pool.query("SELECT * FROM auth_sessions")).rowCount).toBe(0);
      expect(await store.authenticateLocalUser("racer", "replacement-password")).not.toBeNull();
    } finally { resume(); spy.mockRestore(); }
  });

  it("disabled_and_unverified_users_cannot_start_sessions", async () => {
    const user = await store.createLocalUser({ username: "tester", email: "test@example.test", password: "fixture-password" });
    await expect(store.createSession(user.id)).rejects.toThrow();
    await pool.query("UPDATE app_users SET email_verified_at=now() WHERE id=$1", [user.id]);
    const session = await store.createSession(user.id);
    await pool.query("UPDATE app_users SET disabled_at=now() WHERE id=$1", [user.id]);
    await expect(store.createSession(user.id)).rejects.toThrow();
    expect(await store.resolveSession(session.token)).toBeNull();
    expect(await store.verifyLocalUser("tester", "fixture-password")).toBeNull();
  });

  it("parallel_rate_limit_is_shared_across_stores", async () => {
    const second = new AuthStore(pool);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? second : store).consumeRateLimit("login:account@example.test", 5, 900)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect((await pool.query("SELECT * FROM auth_rate_limits")).rows[0].key_hash).toBe(hashToken("login:account@example.test"));
    await pool.query("UPDATE auth_rate_limits SET expires_at=now()-interval '1 second'");
    expect(await store.consumeRateLimit("login:account@example.test", 5, 900)).toBe(true);
    await expect(store.consumeRateLimit("key", 0, 900)).rejects.toThrow();
  });
  it("serializes intersecting account/IP login budgets across stores using a two-client pool and failure-only counters",async()=>{
    const first=await createVerifiedUser(pool,"first"),second=await createVerifiedUser(pool,"second");
    const other=new AuthStore(pool);
    const results=await Promise.all(Array.from({length:8},(_,i)=>(i%2 ? store : other).loginLocalUser(i%2 ? first.username : second.email,"fixture-password",i%3 ? "192.0.2.1" : "192.0.2.2")));
    expect(results.map(result=>result.status)).toEqual(Array(8).fill(200));
    expect((await pool.query("SELECT * FROM auth_rate_limits")).rowCount).toBe(0);
    const ipKey=authRateLimitKey("login","ip","192.0.2.1");
    for(let i=0;i<19;i++) await store.consumeRateLimit(ipKey,20,900);
    expect((await store.loginLocalUser("unknown","wrong-password","192.0.2.1")).status).toBe(401);
    expect((await other.loginLocalUser(first.email,"fixture-password","192.0.2.1")).status).toBe(429);
    expect((await store.loginLocalUser(first.username,"fixture-password","192.0.2.2")).status).toBe(200);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
  it("checks login budget expiry after waiting for admission and releases transaction locks on errors",async()=>{
    const user=await createVerifiedUser(pool,"tester");
    const key=authRateLimitKey("login","account",`user:${user.id}`);
    for(let i=0;i<5;i++) await store.consumeRateLimit(key,5,900);
    const blocker=await pool.connect();
    let login:ReturnType<AuthStore["loginLocalUser"]>|undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock($1::bigint)",[BigInt.asIntN(64,BigInt(`0x${key.slice(0,16)}`)).toString()]);
      login=store.loginLocalUser(user.email,"fixture-password","192.0.2.1");
      for(let i=0;i<100;i++) {
        const blocked=await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'",[schema]);
        if(blocked.rowCount) break;
        if(i===99) throw new Error("Login did not wait for budget admission");
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      await blocker.query("UPDATE auth_rate_limits SET expires_at=clock_timestamp() WHERE key_hash=$1",[hashToken(key)]);
      await blocker.query("COMMIT");
      expect((await login).status).toBe(200);
    } finally {await blocker.query("ROLLBACK");blocker.release();await login;}
    const spy=vi.spyOn(crypto,"verifyPassword").mockRejectedValueOnce(new Error("Credential service busy"));
    try {await expect(store.loginLocalUser(user.username,"fixture-password","192.0.2.1")).rejects.toThrow("Credential service busy");}
    finally {spy.mockRestore();}
    expect((await store.loginLocalUser(user.username,"fixture-password","192.0.2.1")).status).toBe(200);
    expect((await pool.query("SELECT * FROM auth_rate_limits WHERE key_hash=$1",[hashToken(key)])).rowCount).toBe(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
  it("does not cross-delete expired counters owned by another admitted login",async()=>{
    const first=await createVerifiedUser(pool,"first"),second=await createVerifiedUser(pool,"second");
    const accounts=[first,second].map(user=>hashToken(authRateLimitKey("login","account",`user:${user.id}`)));
    const ips=["192.0.2.1","192.0.2.2"].map(ip=>hashToken(authRateLimitKey("login","ip",ip)));
    const unrelated=hashToken("unrelated-expired-counter");
    await pool.query("INSERT INTO auth_rate_limits (key_hash,attempts,expires_at) SELECT unnest($1::text[]),5,clock_timestamp()-interval '1 second'",[[...accounts,unrelated]]);
    const blocker=await admin.connect();
    const original=crypto.verifyPassword;
    let reachedFirst!:()=>void,reachedSecond!:()=>void,release!:()=>void,calls=0;
    const firstWaiting=new Promise<void>(resolve=>{reachedFirst=resolve;});
    const secondWaiting=new Promise<void>(resolve=>{reachedSecond=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const spy=vi.spyOn(crypto,"verifyPassword").mockImplementation(async(password,hash)=>{
      const valid=await original(password,hash);
      if(++calls===1) reachedFirst(); else reachedSecond();
      await gate; return valid;
    });
    const logins:ReturnType<AuthStore["loginLocalUser"]>[]=[];
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT key_hash FROM ${schema}.auth_rate_limits WHERE key_hash=$1 FOR UPDATE`,[accounts[0]]);
      // Old global cleanup skips A's locked row and deletes B's; B then deletes A's after release.
      logins.push(store.loginLocalUser(first.username,"wrong-password","192.0.2.1"));
      await firstWaiting; await blocker.query("COMMIT");
      logins.push(new AuthStore(pool).loginLocalUser(second.email,"wrong-password","192.0.2.2"));
      await secondWaiting; release();
      const results=await Promise.allSettled(logins);
      expect(results.map(result=>result.status==="fulfilled" ? result.value.status : result.reason.code)).toEqual([401,401]);
      const rows=await pool.query("SELECT key_hash,attempts,expires_at>clock_timestamp() AS active FROM auth_rate_limits");
      expect(rows.rows.find(row=>row.key_hash===unrelated)).toEqual({key_hash:unrelated,attempts:5,active:false});
      for(const key of [...accounts,...ips]) expect(rows.rows.find(row=>row.key_hash===key)).toEqual({key_hash:key,attempts:1,active:true});
      expect((await pool.query("SELECT * FROM auth_sessions")).rowCount).toBe(0);
      expect(pool.idleCount).toBe(pool.totalCount);
    } finally {
      await blocker.query("ROLLBACK");blocker.release();release();
      await Promise.allSettled(logins);spy.mockRestore();
    }
  });

  it("uses canonical opaque keys and the specified account/IP policies", async () => {
    const expected = [
      ["loginAccount", 5, 900], ["loginIp", 20, 900], ["registration", 5, 3600],
      ["recovery", 5, 3600], ["resend", 5, 3600], ["googleStart", 20, 900],
    ] as const;
    expect(authRateLimitKey("login", "account", " User@Example.test ")).toBe(authRateLimitKey("login", "account", "user@example.test"));
    expect(authRateLimitKey("login", "account", "same")).not.toBe(authRateLimitKey("login", "ip", "same"));
    expect(authRateLimitKey("login", "account", "same")).not.toBe(authRateLimitKey("recovery", "account", "same"));
    for (const [name, limit, seconds] of expected) {
      const policy = AUTH_RATE_LIMITS[name];
      const key = authRateLimitKey(name, "account", "user@example.test");
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      const results = await Promise.all(Array.from({ length: limit + 1 }, () => store.consumeRateLimit(key, policy.limit, policy.windowSeconds)));
      expect(results.filter(Boolean)).toHaveLength(limit);
      const row = (await pool.query("SELECT expires_at FROM auth_rate_limits WHERE key_hash=$1", [hashToken(key)])).rows[0];
      expect(row.expires_at.getTime() - Date.now()).toBeCloseTo(seconds * 1000, -3);
    }
  });

  it("one-time verification and reset are atomic, expire, and reset revokes sessions", async () => {
    const user = await store.createLocalUser({ username: "tester", email: "test@example.test", password: "fixture-password" });
    const verify = await store.createOneTimeToken(user.id, "verify_email");
    expect(verify.expiresAt.getTime() - Date.now()).toBeCloseTo(86400000, -3);
    const results = await Promise.all([store.consumeVerificationToken(verify.token), store.consumeVerificationToken(verify.token)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const session = await store.createSession(user.id);
    const reset = await store.createOneTimeToken(user.id, "reset_password");
    expect(reset.expiresAt.getTime() - Date.now()).toBeCloseTo(1800000, -3);
    expect((await pool.query("SELECT token_hash FROM auth_tokens WHERE token_hash=$1", [hashToken(reset.token)])).rowCount).toBe(1);
    expect(await store.consumeVerificationToken(reset.token)).toBe(false);
    const resetResults = await Promise.all([store.consumePasswordResetToken(reset.token, "new-password-value"), store.consumePasswordResetToken(reset.token, "new-password-value")]);
    expect(resetResults.filter(Boolean)).toHaveLength(1);
    expect(await store.resolveSession(session.token)).toBeNull();
    expect(await store.verifyLocalUser("tester", "new-password-value")).not.toBeNull();
    const expired = await store.createOneTimeToken(user.id, "reset_password");
    await pool.query("UPDATE auth_tokens SET expires_at=now()-interval '1 second'");
    expect(await store.consumePasswordResetToken(expired.token, "another-password")).toBe(false);
  });

  it("rolls back reset consumption, password and revocation together on failure", async () => {
    const user = await createVerifiedUser(pool, "tester");
    const session = await store.createSession(user.id);
    const reset = await store.createOneTimeToken(user.id, "reset_password");
    await pool.query(`CREATE FUNCTION reject_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced revocation failure'; END $$;
      CREATE TRIGGER reject_session_delete BEFORE DELETE ON auth_sessions FOR EACH ROW EXECUTE FUNCTION reject_session_delete()`);
    try {
      await expect(store.consumePasswordResetToken(reset.token, "new-password-value")).rejects.toThrow("forced revocation failure");
      expect(await store.resolveSession(session.token)).toEqual(user);
      expect(await store.verifyLocalUser("tester", "fixture-password")).toEqual(user);
      expect((await pool.query("SELECT consumed_at FROM auth_tokens WHERE token_hash=$1", [hashToken(reset.token)])).rows[0].consumed_at).toBeNull();
    } finally {
      await pool.query("DROP TRIGGER reject_session_delete ON auth_sessions; DROP FUNCTION reject_session_delete()");
    }
    expect(await store.consumePasswordResetToken(reset.token, "new-password-value")).toBe(true);
    expect(pool.idleCount).toBe(pool.totalCount);
  });

  it("rechecks token expiry after waiting for an account lock", async () => {
    const user = await createVerifiedUser(pool, "tester");
    const verify = await store.createOneTimeToken(user.id, "verify_email");
    const blocker = await pool.connect();
    let consumption: Promise<boolean> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM app_users WHERE id=$1 FOR UPDATE", [user.id]);
      consumption = store.consumeVerificationToken(verify.token);
      for (let i = 0; i < 100; i++) {
        const blocked = await admin.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF u%'");
        if (blocked.rowCount) break;
        if (i === 99) throw new Error("Consumption did not wait for account lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await blocker.query("UPDATE auth_tokens SET expires_at=clock_timestamp() WHERE token_hash=$1", [hashToken(verify.token)]);
      await blocker.query("COMMIT");
      expect(await consumption).toBe(false);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await consumption;
    }
  });
});
