import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hashPassword, hashToken, newToken, verifyPassword } from "./auth-crypto.js";

export interface AuthUser { id: string; username: string; email: string }
export type TokenPurpose = "verify_email" | "reset_password";

export function isAccountEmail(email: string): boolean {
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email);
}

export const AUTH_RATE_LIMITS = {
  loginAccount: { limit: 5, windowSeconds: 900 },
  loginIp: { limit: 20, windowSeconds: 900 },
  registration: { limit: 5, windowSeconds: 3600 },
  recovery: { limit: 5, windowSeconds: 3600 },
  resend: { limit: 5, windowSeconds: 3600 },
  googleStart: { limit: 20, windowSeconds: 900 },
} as const;

export function authRateLimitKey(action: string, scope: "account" | "ip", identity: string): string {
  return hashToken(JSON.stringify([action, scope, identity.trim().toLowerCase()]));
}

function userView(row: AuthUser): AuthUser {
  return { id: row.id, username: row.username, email: row.email };
}

export class AuthStore {
  constructor(private readonly pool: Pool) {}

  async createLocalUser(input: { username: string; email: string; password: string }, deliver?: (user: AuthUser, token: string) => Promise<void>): Promise<AuthUser> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(username) || username === "legacy") throw new Error("Invalid username");
    if (!isAccountEmail(email)) throw new Error("Invalid email");
    const passwordHash = await hashPassword(input.password);
    return this.transaction(async client => {
      const result = await client.query<AuthUser>(`INSERT INTO app_users (id,username,email,password_hash)
        VALUES ($1,$2,$3,$4) RETURNING id,username,email`, [randomUUID(), username, email, passwordHash]);
      const user = userView(result.rows[0]);
      if (deliver) await deliver(user, (await this.insertToken(client, user.id, "verify_email")).token);
      return user;
    });
  }

  async verifyLocalUser(login: string, password: string): Promise<AuthUser | null> {
    const normalized = login.trim().toLowerCase();
    const result = await this.pool.query(`SELECT id,username,email,password_hash,email_verified_at,disabled_at
      FROM app_users WHERE username=$1 OR email=$1`, [normalized]);
    const row = result.rows[0];
    const valid = await verifyPassword(password, row?.password_hash ?? "");
    return valid && row?.email_verified_at && !row.disabled_at ? userView(row) : null;
  }

  async authenticateLocalUser(login: string, password: string) {
    const result = await this.pool.query(`SELECT id,password_hash FROM app_users WHERE username=$1 OR email=$1`, [login.trim().toLowerCase()]);
    const read = result.rows[0];
    const valid = await verifyPassword(password, read?.password_hash ?? "");
    if (!valid || !read) return null;
    return this.transaction(async client => {
      // A reset may finish during the KDF: compare the credential version under the same lock as revocation.
      const locked = await client.query(`SELECT id,username,email,password_hash,email_verified_at,disabled_at FROM app_users WHERE id=$1 FOR UPDATE`, [read.id]);
      const row = locked.rows[0];
      if (!row || row.password_hash !== read.password_hash || !row.email_verified_at || row.disabled_at) return null;
      const session = await this.insertSession(client, row.id);
      return { user: userView(row), ...session };
    });
  }

  async loginRateIdentity(login: string): Promise<string> {
    const normalized = login.trim().toLowerCase();
    const result = await this.pool.query("SELECT id FROM app_users WHERE username=$1 OR email=$1", [normalized]);
    return result.rows[0] ? `user:${result.rows[0].id}` : `unknown:${normalized}`;
  }

  async rateLimitAvailable(key: string, limit: number): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM auth_rate_limits WHERE key_hash=$1 AND expires_at>now() AND attempts>=$2", [hashToken(key),limit]);
    return !result.rowCount;
  }

  async rotateSessionCsrf(token: string): Promise<string> {
    const csrfToken = newToken();
    await this.pool.query("UPDATE auth_sessions SET csrf_hash=$2 WHERE token_hash=$1 AND expires_at>now()", [hashToken(token),hashToken(csrfToken)]);
    return csrfToken;
  }

  async createSession(userId: string): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    return this.transaction(async client => {
      const eligible = await client.query("SELECT id FROM app_users WHERE id=$1 AND disabled_at IS NULL AND email_verified_at IS NOT NULL FOR UPDATE", [userId]);
      if (!eligible.rowCount) throw new Error("Account unavailable");
      return this.insertSession(client, userId);
    });
  }

  private async insertSession(client: PoolClient, userId: string) {
    const token = newToken();
    const csrfToken = newToken();
    const result = await client.query(`INSERT INTO auth_sessions (id,user_id,token_hash,csrf_hash,expires_at)
      VALUES ($2,$1,$3,$4,now()+interval '7 days') RETURNING expires_at`,
    [userId, randomUUID(), hashToken(token), hashToken(csrfToken)]);
    if (!result.rowCount) throw new Error("Account unavailable");
    return { token, csrfToken, expiresAt: result.rows[0].expires_at };
  }

  async resolveSession(token: string): Promise<AuthUser | null> {
    const result = await this.pool.query<AuthUser>(`SELECT u.id,u.username,u.email FROM auth_sessions s
      JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()
      AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL`, [hashToken(token)]);
    return result.rows[0] ? userView(result.rows[0]) : null;
  }

  async verifySessionCsrf(token: string, csrfToken: string): Promise<boolean> {
    const result = await this.pool.query(`SELECT s.csrf_hash FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL`, [hashToken(token)]);
    return !!result.rows[0] && timingSafeEqual(Buffer.from(result.rows[0].csrf_hash, "hex"), Buffer.from(hashToken(csrfToken), "hex"));
  }

  async revokeSession(token: string): Promise<void> {
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash=$1", [hashToken(token)]);
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000000 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400) throw new Error("Invalid rate limit");
    await this.pool.query("DELETE FROM auth_rate_limits WHERE expires_at<=now()");
    const result = await this.pool.query(`INSERT INTO auth_rate_limits (key_hash,attempts,expires_at)
      VALUES ($1,1,now()+$3*interval '1 second') ON CONFLICT (key_hash) DO UPDATE
      SET attempts=CASE WHEN auth_rate_limits.expires_at<=now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
        expires_at=CASE WHEN auth_rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
      WHERE auth_rate_limits.expires_at<=now() OR auth_rate_limits.attempts<$2 RETURNING key_hash`,
    [hashToken(key), limit, windowSeconds]);
    return !!result.rowCount;
  }

  async createOneTimeToken(userId: string, purpose: TokenPurpose): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const seconds = purpose === "verify_email" ? 86400 : 1800;
    const result = await this.pool.query(`INSERT INTO auth_tokens (id,user_id,purpose,token_hash,expires_at)
      SELECT $1,id,$3,$4,now()+$5*interval '1 second' FROM app_users WHERE id=$2 AND disabled_at IS NULL
      RETURNING expires_at`, [randomUUID(), userId, purpose, hashToken(token), seconds]);
    if (!result.rowCount) throw new Error("Account unavailable");
    return { token, expiresAt: result.rows[0].expires_at };
  }

  async consumeVerificationToken(token: string): Promise<boolean> {
    return this.consumeOneTimeToken(token, "verify_email");
  }

  async deliverAccountToken(email: string, purpose: TokenPurpose, deliver: (email: string, token: string) => Promise<void>): Promise<void> {
    await this.transaction(async client => {
      const result = await client.query(`SELECT id,email,email_verified_at FROM app_users WHERE email=$1 AND disabled_at IS NULL FOR UPDATE`, [email.trim().toLowerCase()]);
      const row = result.rows[0];
      // Equal SMTP work prevents recipient rejection from becoming an account-existence oracle.
      if (!row || (purpose === "verify_email" && row.email_verified_at)) { await deliver(email.trim().toLowerCase(),newToken()); return; }
      const token = await this.insertToken(client, row.id, purpose);
      await deliver(row.email, token.token);
    });
  }

  async provisionLegacy(email: string, deliver: (invitation: { verificationToken: string; resetToken: string }) => Promise<void>): Promise<void> {
    email = email.trim().toLowerCase();
    if (!isAccountEmail(email)) throw new Error("Invalid email");
    await this.transaction(async client => {
      const result = await client.query("SELECT * FROM app_users WHERE username='legacy' FOR UPDATE");
      const row = result.rows[0];
      if (!row || !row.disabled_at || (row.password_hash && row.email_verified_at) || (row.email && row.email !== email)) throw new Error("Legacy account is already claimed");
      await client.query("UPDATE app_users SET email=$1,updated_at=now() WHERE id=$2",[email,row.id]);
      await client.query("UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",[row.id]);
      const verification = await this.insertToken(client,row.id,"verify_email");
      const reset = await this.insertToken(client,row.id,"reset_password");
      await deliver({verificationToken:verification.token,resetToken:reset.token});
    });
  }

  private async insertToken(client: PoolClient, userId: string, purpose: TokenPurpose) {
    const token = newToken();
    const result = await client.query(`INSERT INTO auth_tokens (id,user_id,purpose,token_hash,expires_at)
      VALUES ($1,$2,$3,$4,now()+$5*interval '1 second') RETURNING expires_at`,[randomUUID(),userId,purpose,hashToken(token),purpose === "verify_email" ? 86400 : 1800]);
    return {token,expiresAt:result.rows[0].expires_at as Date};
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const value = await work(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async consumePasswordResetToken(token: string, password: string): Promise<boolean> {
    return this.consumeOneTimeToken(token, "reset_password", await hashPassword(password));
  }

  private async consumeOneTimeToken(token: string, purpose: TokenPurpose, passwordHash?: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the account first, also serializing session issuance with reset revocation.
      const user = await client.query(`SELECT u.id FROM app_users u JOIN auth_tokens t ON t.user_id=u.id
        WHERE t.token_hash=$1 AND t.purpose=$2 AND (u.disabled_at IS NULL OR
          (u.username='legacy' AND u.email IS NOT NULL AND (u.password_hash IS NULL OR u.email_verified_at IS NULL))) FOR UPDATE OF u`, [hashToken(token), purpose]);
      const consumed = user.rowCount ? await client.query(`UPDATE auth_tokens SET consumed_at=clock_timestamp()
        WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING user_id`, [hashToken(token), purpose]) : null;
      if (!consumed?.rowCount) { await client.query("ROLLBACK"); return false; }
      const userId = consumed.rows[0].user_id;
      if (purpose === "verify_email") {
        await client.query("UPDATE app_users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1", [userId]);
      } else {
        await client.query("UPDATE app_users SET password_hash=$2,updated_at=now() WHERE id=$1", [userId, passwordHash]);
        await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
        await client.query("UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='reset_password' AND consumed_at IS NULL", [userId]);
      }
      await client.query(`UPDATE app_users SET disabled_at=NULL WHERE id=$1 AND username='legacy'
        AND email_verified_at IS NOT NULL AND password_hash IS NOT NULL`, [userId]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
