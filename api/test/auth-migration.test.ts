import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticatedClient, createVerifiedUser } from "./helpers/auth.js";
import { verifyPassword } from "../src/auth-crypto.js";

const schemaSql = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
const legacyId = "00000000-0000-0000-0000-000000000001";
const roots = ["candidates", "candidate_lists", "battlefields", "auctions"];

function disposableDatabaseUrl(): string {
  const value = process.env.AUTH_TEST_DATABASE_URL;
  if (!value || !/^\/[^/]*(?:test|disposable)[^/]*$/i.test(new URL(value).pathname)) {
    throw new Error("AUTH_TEST_DATABASE_URL must explicitly name a disposable/test database; DATABASE_URL is never used");
  }
  return value;
}

describe("safe identity migration", () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `auth_migration_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    const connectionString = disposableDatabaseUrl();
    admin = new Pool({ connectionString });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 1 });
    // Pre-auth roots, including columns introduced by earlier product migrations.
    await pool.query(`
      CREATE TABLE candidates (id text PRIMARY KEY, name text NOT NULL, image bytea NOT NULL,
        image_mime text NOT NULL, image_name text NOT NULL, archived_at timestamptz, created_at timestamptz DEFAULT now());
      CREATE TABLE candidate_lists (id text PRIMARY KEY, name text NOT NULL, is_draft boolean DEFAULT true,
        archived_at timestamptz, created_at timestamptz DEFAULT now());
      CREATE TABLE battlefields (id text PRIMARY KEY, name text NOT NULL, geography text NOT NULL, history text NOT NULL,
        image bytea NOT NULL, image_mime text NOT NULL, image_name text NOT NULL, archived_at timestamptz,
        created_at timestamptz DEFAULT now());
      CREATE TABLE auctions (id text PRIMARY KEY, name text NOT NULL, source_list_id text REFERENCES candidate_lists(id),
        follows_source boolean DEFAULT true, battlefield_id text, preparation jsonb DEFAULT '{}',
        simulation_prompt_template text DEFAULT '', status text DEFAULT 'draft',
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        background_image bytea, background_mime text, background_name text,
        battlefield_geography text, battlefield_history text, battlefield_image bytea,
        battlefield_image_mime text, battlefield_image_name text);
      INSERT INTO candidates VALUES ('candidate', 'Legacy', '\\x010203', 'image/png', 'legacy.png', NULL, now());
      INSERT INTO candidate_lists (id,name) VALUES ('list','Legacy list');
      INSERT INTO battlefields (id,name,geography,history,image,image_mime,image_name)
        VALUES ('field','Legacy field','Valley','History','\\x040506','image/png','field.png');
      INSERT INTO auctions (id,name,source_list_id,battlefield_id,status)
        VALUES ('auction','Legacy battle','list','field','completed');
      UPDATE auctions SET preparation='{"locked":true,"teams":["team"],"steps":{"battlefield":true}}',
        background_image='\\x202122', background_mime='image/png', background_name='background.png',
        battlefield_geography='Overridden valley', battlefield_history='Historical override',
        battlefield_image='\\x303132', battlefield_image_mime='image/png', battlefield_image_name='override.png';
      CREATE TABLE list_entries (list_id text REFERENCES candidate_lists(id), candidate_id text REFERENCES candidates(id),
        position integer NOT NULL, PRIMARY KEY(list_id,candidate_id), UNIQUE(list_id,position));
      CREATE TABLE auction_entries (auction_id text REFERENCES auctions(id), candidate_id text REFERENCES candidates(id),
        position integer NOT NULL, PRIMARY KEY(auction_id,candidate_id), UNIQUE(auction_id,position));
      INSERT INTO list_entries VALUES ('list','candidate',0);
      INSERT INTO auction_entries VALUES ('auction','candidate',0);
      CREATE TABLE auction_teams (id text PRIMARY KEY, auction_id text REFERENCES auctions(id), name text NOT NULL,
        slogan text, flag_image bytea NOT NULL, flag_mime text NOT NULL, flag_name text NOT NULL,
        position integer NOT NULL, created_at timestamptz DEFAULT now());
      CREATE TABLE auction_team_members (id text PRIMARY KEY, team_id text REFERENCES auction_teams(id),
        name text NOT NULL, avatar_image bytea, avatar_mime text, avatar_name text,
        initial_gold integer NOT NULL, created_at timestamptz DEFAULT now());
      INSERT INTO auction_teams (id,auction_id,name,flag_image,flag_mime,flag_name,position)
        VALUES ('team','auction','North','\\x1011','image/png','flag.png',0);
      INSERT INTO auction_team_members (id,team_id,name,avatar_image,avatar_mime,avatar_name,initial_gold)
        VALUES ('member','team','Player','\\x1213','image/png','avatar.png',100);
      CREATE TABLE auction_live_acquired (auction_id text REFERENCES auctions(id), candidate_id text REFERENCES candidates(id),
        team_position integer NOT NULL, price integer NOT NULL, PRIMARY KEY(auction_id,candidate_id));
      INSERT INTO auction_live_acquired VALUES ('auction','candidate',0,25);
      CREATE TABLE auction_live_balances (auction_id text REFERENCES auctions(id), member_id text REFERENCES auction_team_members(id),
        balance integer NOT NULL, PRIMARY KEY(auction_id,member_id));
      INSERT INTO auction_live_balances VALUES ('auction','member',75);
      CREATE TABLE auction_live_history (id serial PRIMARY KEY, auction_id text REFERENCES auctions(id),
        snapshot jsonb NOT NULL, created_at timestamptz DEFAULT now());
      INSERT INTO auction_live_history (auction_id,snapshot) VALUES ('auction','{"cursor":1,"price":25}');
    `);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("preserves the legacy graph, locks its owner, and never reassigns new private resources", async () => {
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of [...roots, "list_entries", "auction_entries", "auction_teams", "auction_team_members",
        "auction_live_acquired", "auction_live_balances", "auction_live_history"]) {
        result[table] = (await pool.query(`SELECT to_jsonb(t) - 'owner_user_id' - 'is_public' AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
      }
      return result;
    };
    const before = await snapshot();
    await pool.query(schemaSql);
    expect(await snapshot()).toEqual(before);
    const legacy = (await pool.query("SELECT * FROM app_users WHERE id=$1", [legacyId])).rows[0];
    expect(legacy).toMatchObject({ username: "legacy", email: null, password_hash: null, email_verified_at: null });
    expect(legacy.disabled_at).not.toBeNull();
    for (const table of roots) {
      expect((await pool.query(`SELECT owner_user_id FROM ${table}`)).rows).toEqual([{ owner_user_id: legacyId }]);
      if (table !== "auctions") expect((await pool.query(`SELECT is_public FROM ${table}`)).rows[0].is_public).toBe(true);
    }
    const user = await createVerifiedUser(pool, "real_user");
    const verified = (await pool.query("SELECT * FROM app_users WHERE id=$1", [user.id])).rows[0];
    expect(verified.email_verified_at).not.toBeNull();
    expect(verified.disabled_at).toBeNull();
    expect(await verifyPassword("fixture-password", verified.password_hash)).toBe(true);
    await pool.query(`INSERT INTO candidates (id,name,image,image_mime,image_name,owner_user_id)
      VALUES ('private','Private','\\x07','image/png','private.png',$1)`, [user.id]);
    await pool.query("INSERT INTO candidate_lists (id,name,owner_user_id) VALUES ('private-list','Private',$1)", [user.id]);
    await pool.query(`INSERT INTO battlefields (id,name,geography,history,image,image_mime,image_name,owner_user_id)
      VALUES ('private-field','Private','Valley','History','\\x08','image/png','private.png',$1)`, [user.id]);
    await pool.query("INSERT INTO auctions (id,name,owner_user_id) VALUES ('private-auction','Private',$1)", [user.id]);
    await pool.query(schemaSql);
    for (const table of roots) {
      const row = (await pool.query(`SELECT * FROM ${table} WHERE owner_user_id=$1`, [user.id])).rows[0];
      expect(row.owner_user_id).toBe(user.id);
      if (table !== "auctions") expect(row.is_public).toBe(false);
      else expect(row).not.toHaveProperty("is_public");
    }
    expect((await pool.query("SELECT count(*)::int AS n FROM app_users")).rows[0].n).toBe(2);
    for (const table of roots) {
      const column = (await pool.query(`SELECT is_nullable,column_default FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2 AND column_name='owner_user_id'`, [schema, table])).rows[0];
      expect(column).toEqual({ is_nullable: "NO", column_default: null });
    }
    expect((await pool.query(`SELECT column_default FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='app_users' AND column_name='password_hash'`, [schema])).rows[0].column_default).toBeNull();
    await expect(pool.query(`INSERT INTO candidates (id,name,image,image_mime,image_name)
      VALUES ('unowned','No owner','\\x01','image/png','x.png')`)).rejects.toMatchObject({ code: "23502" });
    await expect(pool.query(`INSERT INTO app_users (id,username,email) VALUES ('fake','legacy','fake@example.test')`))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO app_users (id,username,email) VALUES ('mixed','Mixed','mixed@example.test')`))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO app_users (id,username,email) VALUES ('duplicate','other','real_user@example.test')`))
      .rejects.toMatchObject({ code: "23505" });
    await expect(pool.query(`INSERT INTO candidates (id,name,image,image_mime,image_name,owner_user_id)
      VALUES ('orphan','Orphan','\\x01','image/png','x.png','missing')`)).rejects.toMatchObject({ code: "23503" });
    for (const table of ["auth_tokens", "auth_sessions"]) {
      const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`, [schema, table])).rows.map((row) => row.column_name);
      expect(columns).toContain("token_hash");
      expect(columns).toContain("expires_at");
      expect(columns).not.toContain("token");
      if (table === "auth_tokens") expect(columns).toContain("consumed_at");
      else expect(columns).toContain("csrf_hash");
    }
    const rateColumns = (await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name='auth_rate_limits'`, [schema])).rows.map((row) => row.column_name);
    expect(rateColumns.sort()).toEqual(["attempts", "expires_at", "key_hash"]);
    await expect(pool.query("INSERT INTO auth_rate_limits VALUES ('raw-account@example.test',1,now())"))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO app_users (id,username,email) VALUES ('dash','has-dash','dash@example.test')"))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO auth_tokens (id,user_id,purpose,token_hash,expires_at)
      VALUES ('bad',$1,'login','hash',now())`, [user.id])).rejects.toMatchObject({ code: "23514" });
  });

  it("rolls back all identity and ownership DDL when the migration fails", async () => {
    const isolated = `${schema}_rollback`;
    await admin.query(`CREATE SCHEMA "${isolated}"`);
    const failed = new Pool({ connectionString: disposableDatabaseUrl(), options: `-c search_path=${isolated}`, max: 1 });
    try {
      await expect(failed.query(schemaSql.replace(/COMMIT;\s*$/, "SELECT 1 / 0; COMMIT;")))
        .rejects.toMatchObject({ code: "22012" });
      await failed.query("ROLLBACK");
      expect((await admin.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1", [isolated])).rows[0].n).toBe(0);
    } finally {
      await failed.end();
      await admin.query(`DROP SCHEMA "${isolated}" CASCADE`);
    }
  });
});

it("authenticated fixture logs in, retains cookies, and sends Origin and CSRF", async () => {
  const requests: { url: string; cookie?: string; origin?: string; csrf?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url!, cookie: request.headers.cookie, origin: request.headers.origin,
      csrf: request.headers["x-csrf-token"] as string | undefined, body });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/auth/session") {
      response.setHeader("Set-Cookie", "anonymous=digest; HttpOnly; Path=/");
      response.end(JSON.stringify({ user: null, csrfToken: "anonymous-csrf" }));
    } else if (request.url === "/auth/login") {
      response.setHeader("Set-Cookie", ["session=opaque; HttpOnly; Path=/", "other=value; Path=/"]);
      response.end(JSON.stringify({ csrfToken: "csrf-value" }));
    } else response.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const client = await authenticatedClient(base, { login: "tester", password: "fixture-password" });
    await client("/candidates", { method: "POST", body: "{}" });
    expect(requests[0].url).toBe("/auth/session");
    expect(JSON.parse(requests[1].body)).toEqual({ login: "tester", password: "fixture-password" });
    expect(requests[1]).toMatchObject({ origin: base, cookie: "anonymous=digest", csrf: "anonymous-csrf" });
    expect(requests[2]).toMatchObject({ url: "/candidates", cookie: "anonymous=digest; session=opaque; other=value", origin: base, csrf: "csrf-value" });
    await expect(client("https://example.test/steal")).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
