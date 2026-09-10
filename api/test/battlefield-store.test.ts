import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssetError } from "../src/battlefield-domain.js";
import { BattlefieldStore } from "../src/battlefield-store.js";
import { PersistenceError, PgStore } from "../src/store.js";

const connectionString = process.env.DATABASE_URL
  ?? "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";
const fields = { name: "Valley", geography: "River plain", history: "Old crossing" };
// Task 1 validates signatures, not complete image decoding.
const image = { buffer: Buffer.from("89504e470d0a1a0a", "hex"), mime: "image/png", name: "valley.png" };
const secondImage = { buffer: Buffer.from("GIF89a"), mime: "image/gif", name: "new.gif" };
const schemaSql = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
let admin: Pool;
let pool: Pool;
let schema: string;
let store: PgStore;
let assets: BattlefieldStore;

beforeEach(async () => {
  admin = new Pool({ connectionString });
  schema = `battlefield_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const isolatedUrl = new URL(connectionString);
  // URL options take precedence in pg; overwrite them so even a configured
  // DATABASE_URL search_path cannot direct destructive test DDL at shared tables.
  isolatedUrl.searchParams.set("options", `-c search_path=${schema} -c statement_timeout=5000`);
  isolatedUrl.searchParams.set("application_name", schema);
  pool = new Pool({ connectionString: isolatedUrl.toString() });
  await pool.query(schemaSql);
  store = new PgStore(pool);
  assets = new BattlefieldStore(pool);
});

afterEach(async () => {
  await pool?.end();
  // Only this test's randomly named schema is removed. Shared tables are untouched.
  if (schema) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin?.end();
});

async function waitForBlockedOperation(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await admin.query(
      "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema],
    );
    if (result.rows.length > 0) return;
    await setTimeout(10);
  }
  throw new Error("Expected storage operation to wait for the held PostgreSQL row lock");
}

describe("battlefield persistence", () => {
  it("copies referenced edits atomically and preserves both drafts' archived identity", async () => {
    const original = await assets.create(fields, image);
    const draft1 = await store.saveAuction("First", null);
    const draft2 = await store.saveAuction("Second", null);
    await assets.select(draft1.id, original.id);
    await assets.select(draft2.id, original.id);
    const replacement = await assets.edit(original.id, { ...fields, name: "Revised" }, null);
    expect(replacement.id).not.toBe(original.id);
    expect((await store.getAuction(draft1.id)).battlefieldId).toBe(original.id);
    expect((await store.getAuction(draft2.id)).battlefieldId).toBe(original.id);
    expect(await assets.get(original.id)).toMatchObject({ ...fields, archivedAt: expect.any(String), image });
    expect(await assets.get(replacement.id)).toEqual({ ...replacement, image });
  });

  it("edits unreferenced identity in place, retaining or replacing image bytes", async () => {
    const original = await assets.create(fields, image);
    const revised = { ...fields, name: " Revised ", geography: " Hill ", history: " New " };
    expect(await assets.edit(original.id, revised, null)).toEqual({
      id: original.id, name: "Revised", geography: "Hill", history: "New", archivedAt: null, image,
    });
    expect(await assets.edit(original.id, fields, secondImage)).toEqual({ ...original, image: secondImage });
  });

  it("lists only active summaries but retrieves archived records directly", async () => {
    const original = await assets.create(fields, image);
    const active = await assets.create({ ...fields, name: "Active" }, image);
    await assets.archive(original.id);
    await assets.archive(original.id);
    const { image: _image, ...summary } = active;
    expect(await assets.list()).toEqual([summary]);
    expect(await assets.get(original.id)).toMatchObject({ id: original.id, archivedAt: expect.any(String), image });
    await expect(assets.edit(original.id, fields, null)).rejects.toEqual(new AssetError("battlefield archived"));
  });

  it("rejects unknown battlefield and auction identifiers", async () => {
    const field = await assets.create(fields, image);
    const draft = await store.saveAuction("Draft", null);
    await expect(assets.get("missing")).rejects.toEqual(new AssetError("battlefield not found"));
    await expect(assets.edit("missing", fields, null)).rejects.toEqual(new AssetError("battlefield not found"));
    await expect(assets.archive("missing")).rejects.toEqual(new AssetError("battlefield not found"));
    await expect(assets.select(draft.id, "missing")).rejects.toEqual(new AssetError("battlefield not found"));
    await expect(assets.select("missing", field.id)).rejects.toEqual(new AssetError("auction not found"));
    await expect(assets.select("missing", null)).rejects.toEqual(new AssetError("auction not found"));
  });

  it("allows existing archived selection but rejects new archived selection", async () => {
    const field = await assets.create(fields, image);
    const draft = await store.saveAuction("Draft", null);
    const other = await store.saveAuction("Other", null);
    await assets.select(draft.id, field.id);
    await assets.archive(field.id);
    await assets.select(draft.id, field.id);
    await expect(assets.select(other.id, field.id)).rejects.toEqual(new AssetError("battlefield archived"));
    expect((await store.getAuction(other.id)).battlefieldId).toBeNull();
    await assets.select(draft.id, null);
    expect((await store.getAuction(draft.id)).battlefieldId).toBeNull();
    await expect(assets.select(draft.id, field.id)).rejects.toEqual(new AssetError("battlefield archived"));
  });

  it.each(["ongoing", "completed"])("rejects all selection changes for %s auctions", async (status) => {
    const field = await assets.create(fields, image);
    const draft = await store.saveAuction("Draft", null);
    await assets.select(draft.id, field.id);
    await assets.archive(field.id);
    await pool.query("UPDATE auctions SET status=$2 WHERE id=$1", [draft.id, status]);
    await expect(assets.select(draft.id, field.id)).rejects.toEqual(new AssetError("preparation locked"));
    await expect(assets.select(draft.id, null)).rejects.toEqual(new AssetError("preparation locked"));
    expect((await store.getAuction(draft.id)).battlefieldId).toBe(field.id);
  });

  it("preserves source follow-state and stored entries through selection and clearing", async () => {
    const candidate = await store.saveCandidate("One", image.buffer, image.mime, image.name);
    const list = await store.saveList("Source", false);
    await store.addEntryToList(list.id, candidate.id);
    const draft = await store.saveAuction("Draft", list.id);
    const before = await pool.query("SELECT * FROM auction_entries WHERE auction_id=$1", [draft.id]);
    const field = await assets.create(fields, image);
    await assets.select(draft.id, field.id);
    await assets.select(draft.id, null);
    expect(await store.getAuction(draft.id)).toEqual(draft);
    expect((await pool.query("SELECT * FROM auction_entries WHERE auction_id=$1", [draft.id])).rows).toEqual(before.rows);
    const next = await store.saveCandidate("Two", image.buffer, image.mime, image.name);
    await store.addEntryToList(list.id, next.id);
    expect((await store.getAuction(draft.id)).entries).toEqual([candidate.id, next.id]);
  });

  it("rolls back the replacement if archiving fails and releases its transaction client", async () => {
    const original = await assets.create(fields, image);
    const draft = await store.saveAuction("Draft", null);
    await assets.select(draft.id, original.id);
    await pool.query(`
      CREATE FUNCTION reject_archive() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced archive failure'; END $$;
      CREATE TRIGGER reject_archive BEFORE UPDATE OF archived_at ON battlefields
        FOR EACH ROW EXECUTE FUNCTION reject_archive();
    `);
    await expect(assets.edit(original.id, { ...fields, name: "Replacement" }, secondImage)).rejects.toThrow("forced archive failure");
    expect(await assets.get(original.id)).toEqual(original);
    expect((await pool.query("SELECT id FROM battlefields")).rows).toEqual([{ id: original.id }]);
    expect((await store.getAuction(draft.id)).battlefieldId).toBe(original.id);
    expect(pool.idleCount).toBe(pool.totalCount);
    await pool.query("DROP TRIGGER reject_archive ON battlefields");
    expect((await assets.edit(original.id, fields, secondImage)).image).toEqual(secondImage);
  });

  it("validates fields and image signatures before persisting", async () => {
    await expect(assets.create({ ...fields, name: " " }, image)).rejects.toEqual(new AssetError("invalid name"));
    await expect(assets.create(fields, { ...image, buffer: Buffer.from("bad") })).rejects.toEqual(new AssetError("invalid image"));
    const original = await assets.create(fields, image);
    await expect(assets.edit(original.id, fields, { ...image, mime: "image/jpeg" })).rejects.toEqual(new AssetError("invalid image"));
    expect(await assets.get(original.id)).toEqual(original);
  });

  it("locks battlefield before auction and rechecks archive state after waiting", async () => {
    const field = await assets.create(fields, image);
    const draft = await store.saveAuction("Draft", null);
    const blocker = await pool.connect();
    let selecting: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM battlefields WHERE id=$1 FOR UPDATE", [field.id]);
      selecting = assets.select(draft.id, field.id).catch((error: unknown) => error);
      await waitForBlockedOperation();
      // Would fail immediately if selection locked the auction before battlefield.
      await blocker.query("SELECT id FROM auctions WHERE id=$1 FOR UPDATE NOWAIT", [draft.id]);
      await blocker.query("UPDATE battlefields SET archived_at=now() WHERE id=$1", [field.id]);
      await blocker.query("COMMIT");
      expect(await selecting).toEqual(new AssetError("battlefield archived"));
      expect((await store.getAuction(draft.id)).battlefieldId).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await selecting;
    }
  });

  it("rechecks references after an edit waits for a battlefield lock", async () => {
    const original = await assets.create(fields, image);
    const draft = await store.saveAuction("Draft", null);
    const blocker = await pool.connect();
    let editing: ReturnType<BattlefieldStore["edit"]> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM battlefields WHERE id=$1 FOR UPDATE", [original.id]);
      editing = assets.edit(original.id, { ...fields, name: "Revised" }, null);
      // Attach a handler while the transaction is blocked to avoid unhandled rejection on failure.
      void editing.catch(() => undefined);
      await waitForBlockedOperation();
      await blocker.query("UPDATE auctions SET battlefield_id=$2 WHERE id=$1", [draft.id, original.id]);
      await blocker.query("COMMIT");
      expect((await editing).id).not.toBe(original.id);
      expect((await assets.get(original.id)).archivedAt).not.toBeNull();
      expect((await store.getAuction(draft.id)).battlefieldId).toBe(original.id);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await editing?.catch(() => undefined);
    }
  });

  it("serializes archiving with an existing battlefield row lock", async () => {
    const field = await assets.create(fields, image);
    const blocker = await pool.connect();
    let archiving: Promise<void> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM battlefields WHERE id=$1 FOR UPDATE", [field.id]);
      archiving = assets.archive(field.id);
      void archiving.catch(() => undefined);
      await waitForBlockedOperation();
      expect((await assets.get(field.id)).archivedAt).toBeNull();
      await blocker.query("COMMIT");
      await archiving;
      expect((await assets.get(field.id)).archivedAt).not.toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await archiving?.catch(() => undefined);
    }
  });

  it("exposes validated selection and persistence wrapping through PgStore", async () => {
    const field = await store.battlefields.create(fields, image);
    const draft = await store.saveAuction("Draft", null);
    expect((await store.setAuctionBattlefield(draft.id, field.id)).battlefieldId).toBe(field.id);
    await store.battlefields.archive(field.id);
    await expect(store.battlefields.edit(field.id, fields, null)).rejects.toBeInstanceOf(AssetError);
    await expect(store.setAuctionBattlefield(draft.id, "missing")).rejects.toBeInstanceOf(AssetError);
    await pool.query("ALTER TABLE battlefields RENAME TO unavailable_battlefields");
    await expect(store.battlefields.list()).rejects.toBeInstanceOf(PersistenceError);
    await expect(store.setAuctionBattlefield(draft.id, field.id)).rejects.toBeInstanceOf(PersistenceError);
  });

  it("keeps query-only mock PgStore construction supported", async () => {
    const mock = new PgStore({ query: async () => { throw new Error("offline"); } });
    await expect(mock.listAuctions()).rejects.toBeInstanceOf(PersistenceError);
    await expect(mock.setAuctionBattlefield("draft", null)).rejects.toBeInstanceOf(PersistenceError);
    await mock.close();
  });
});

describe("background persistence", () => {
  it("reads auction metadata without transferring background columns", async () => {
    const draft = await store.saveAuction("Metadata", null);
    const buffer = Buffer.alloc(5 * 1024 * 1024);
    image.buffer.copy(buffer);
    await assets.setBackground(draft.id, { ...image, buffer });
    const returnedColumns: string[][] = [];
    const metadataStore = new PgStore({
      query: async (text, params) => {
        const result = await pool.query(text, params);
        returnedColumns.push(result.fields.map((field) => field.name));
        return result;
      },
    });
    expect(await metadataStore.getAuction(draft.id)).toEqual(draft);
    expect(await metadataStore.listAuctions()).toEqual([draft]);
    for (const columns of returnedColumns) {
      expect(columns).not.toContain("background_image");
      expect(columns).not.toContain("background_mime");
      expect(columns).not.toContain("background_name");
    }
    expect((await assets.getBackground(draft.id))?.buffer.equals(buffer)).toBe(true);
  });

  it("round-trips and resets only the target draft background without forking", async () => {
    const list = await store.saveList("Source", false);
    const draft = await store.saveAuction("Draft", list.id);
    const other = await store.saveAuction("Other", null);
    expect(await assets.getBackground(draft.id)).toBeNull();
    await assets.setBackground(draft.id, image);
    expect(await new BattlefieldStore(pool).getBackground(draft.id)).toEqual(image);
    expect(await assets.getBackground(other.id)).toBeNull();
    expect(await store.getAuction(draft.id)).toEqual(draft);
    await assets.setBackground(draft.id, secondImage);
    expect(await assets.getBackground(draft.id)).toEqual(secondImage);
    await assets.setBackground(draft.id, null);
    expect(await assets.getBackground(draft.id)).toBeNull();
    expect((await pool.query("SELECT background_image, background_mime, background_name FROM auctions WHERE id=$1", [draft.id])).rows[0])
      .toEqual({ background_image: null, background_mime: null, background_name: null });
  });

  it("rejects missing auctions, invalid images and locked background writes", async () => {
    await expect(assets.getBackground("missing")).rejects.toEqual(new AssetError("auction not found"));
    await expect(assets.setBackground("missing", null)).rejects.toEqual(new AssetError("auction not found"));
    const draft = await store.saveAuction("Draft", null);
    await expect(assets.setBackground(draft.id, { ...image, buffer: Buffer.alloc(0) })).rejects.toEqual(new AssetError("image required"));
    await assets.setBackground(draft.id, image);
    for (const status of ["ongoing", "completed"]) {
      await pool.query("UPDATE auctions SET status=$2 WHERE id=$1", [draft.id, status]);
      await expect(assets.setBackground(draft.id, secondImage)).rejects.toEqual(new AssetError("preparation locked"));
      await expect(assets.setBackground(draft.id, null)).rejects.toEqual(new AssetError("preparation locked"));
      expect(await assets.getBackground(draft.id)).toEqual(image);
    }
  });
});

describe("battlefield migration", () => {
  it("is repeatable and keeps existing rows and restrictive references", async () => {
    const field = await assets.create(fields, image);
    const draft = await store.saveAuction("Preserved", null);
    await assets.select(draft.id, field.id);
    await pool.query(schemaSql);
    await pool.query(schemaSql);
    expect(await assets.get(field.id)).toEqual(field);
    expect((await store.getAuction(draft.id)).battlefieldId).toBe(field.id);
    await expect(pool.query("DELETE FROM battlefields WHERE id=$1", [field.id])).rejects.toMatchObject({ constraint: "auctions_battlefield_id_fkey" });
    expect(await assets.get(field.id)).toEqual(field);
    await expect(pool.query("UPDATE auctions SET battlefield_id='missing' WHERE id=$1", [draft.id])).rejects.toMatchObject({ code: "23503" });
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conname='auctions_battlefield_id_fkey' AND conrelid='auctions'::regclass")).rows[0].count).toBe(1);
  });

  it("refuses dangling legacy IDs, rolls back migration, then migrates valid legacy rows", async () => {
    await pool.query("ALTER TABLE auctions DROP CONSTRAINT auctions_battlefield_id_fkey");
    await pool.query("ALTER TABLE auctions DROP COLUMN background_image, DROP COLUMN background_mime, DROP COLUMN background_name");
    const draft = await store.saveAuction("Legacy", null);
    await pool.query("UPDATE auctions SET battlefield_id='legacy-missing' WHERE id=$1", [draft.id]);
    const client = await pool.connect();
    try {
      await expect(client.query(schemaSql)).rejects.toThrow(/legacy-missing/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect((await store.getAuction(draft.id)).battlefieldId).toBe("legacy-missing");
    expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='auctions' AND column_name='background_image'", [schema])).rows).toEqual([]);
    // Supply the missing record, never clear the legacy reference.
    await pool.query("INSERT INTO battlefields (id,name,geography,history,image,image_mime,image_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      ["legacy-missing", fields.name, fields.geography, fields.history, image.buffer, image.mime, image.name]);
    await pool.query(schemaSql);
    await pool.query(schemaSql);
    expect((await store.getAuction(draft.id)).battlefieldId).toBe("legacy-missing");
    expect(await assets.getBackground(draft.id)).toBeNull();
  });
});
