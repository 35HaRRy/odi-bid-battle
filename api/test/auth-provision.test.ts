import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth-store.js";
import { hashToken } from "../src/auth-crypto.js";

describe("operator legacy invitation", () => {
  const schema = `auth_claim_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, auth: AuthStore;
  beforeAll(async () => {
    const value = process.env.AUTH_TEST_DATABASE_URL;
    if (!value || !/^\/[^/]*(?:test|disposable)[^/]*$/i.test(new URL(value).pathname)) throw new Error("Explicit disposable AUTH_TEST_DATABASE_URL required");
    admin = new Pool({connectionString:value}); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(value); url.searchParams.set("options",`-c search_path=${schema}`);
    pool = new Pool({connectionString:url.toString()});
    await pool.query(await readFile(new URL("../../db/schema.sql",import.meta.url),"utf8")); auth = new AuthStore(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE auth_tokens,auth_sessions; UPDATE app_users SET email=NULL,password_hash=NULL,email_verified_at=NULL,disabled_at=now() WHERE username='legacy'"); });
  afterAll(async () => { await pool?.end(); if(admin) {await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();} });
  it("rolls back delivery failure, permits same-recipient retry, refuses a different claimant", async () => {
    let invalidVerification="";
    await expect(auth.provisionLegacy("operator@example.test", async invitation => { invalidVerification=invitation.verificationToken; throw new Error("second delivery failed after first acceptance"); })).rejects.toThrow();
    expect((await pool.query("SELECT email,disabled_at FROM app_users WHERE username='legacy'")).rows[0]).toMatchObject({email:null,disabled_at:expect.any(Date)});
    expect((await pool.query("SELECT * FROM auth_tokens")).rowCount).toBe(0);
    expect(await auth.consumeVerificationToken(invalidVerification)).toBe(false);
    let deliveries=0;
    const claims = await Promise.allSettled([auth.provisionLegacy("operator@example.test",async()=>{deliveries++;}),auth.provisionLegacy("other@example.test",async()=>{deliveries++;})]);
    expect(claims.filter(r=>r.status==="fulfilled")).toHaveLength(1); expect(deliveries).toBe(1);
    const email = (await pool.query("SELECT email FROM app_users WHERE username='legacy'")).rows[0].email;
    const oldHashes=(await pool.query("SELECT token_hash FROM auth_tokens ORDER BY token_hash")).rows;
    await expect(auth.provisionLegacy(email,async()=>{throw new Error("retry delivery failed");})).rejects.toThrow();
    expect((await pool.query("SELECT token_hash FROM auth_tokens WHERE consumed_at IS NULL ORDER BY token_hash")).rows).toEqual(oldHashes);
    await auth.provisionLegacy(email,async()=>{deliveries++;}); expect(deliveries).toBe(2);
    expect((await pool.query("SELECT * FROM auth_tokens WHERE consumed_at IS NULL")).rowCount).toBe(2);
  });
  it("leaves an expired invitation locked and reissues fresh tokens only to the approved recipient",async()=>{
    let verification="",reset="";
    const capture=async (invitation:{verificationToken:string;resetToken:string})=>{verification=invitation.verificationToken;reset=invitation.resetToken;};
    await auth.provisionLegacy("operator@example.test",capture);
    const old=hashToken(reset);
    await pool.query("UPDATE auth_tokens SET expires_at=now()-interval '1 second' WHERE purpose='reset_password'");
    expect(await auth.consumeVerificationToken(verification)).toBe(true);
    expect(await auth.consumePasswordResetToken(reset,"operator-password")).toBe(false);
    await expect(auth.createSession("00000000-0000-0000-0000-000000000001")).rejects.toThrow();
    await auth.provisionLegacy("operator@example.test",capture);
    expect(hashToken(reset)===old).toBe(false);
    expect(await auth.consumePasswordResetToken(reset,"operator-password")).toBe(true);
    expect(await auth.authenticateLocalUser("legacy","operator-password")).not.toBeNull();
  });
  it.each([true,false])("only activates after both verification and password setup (verification first: %s)",async (verifyFirst) => {
    let verify="",reset="";
    await auth.provisionLegacy("operator@example.test",async invitation=>{verify=invitation.verificationToken;reset=invitation.resetToken;});
    const id="00000000-0000-0000-0000-000000000001";
    await expect(auth.createSession(id)).rejects.toThrow();
    const verification = () => auth.consumeVerificationToken(verify);
    const password = () => auth.consumePasswordResetToken(reset,"operator-password");
    expect(await (verifyFirst ? verification() : password())).toBe(true);
    await expect(auth.createSession(id)).rejects.toThrow();
    expect(await auth.verifyLocalUser("legacy","operator-password")).toBeNull();
    expect(await (verifyFirst ? password() : verification())).toBe(true);
    expect(await auth.authenticateLocalUser("legacy","operator-password")).not.toBeNull();
    expect(await verification()).toBe(false); expect(await password()).toBe(false);
    await expect(auth.provisionLegacy("operator@example.test",async()=>{})).rejects.toThrow();
  });
});
