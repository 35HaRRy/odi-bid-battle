import { afterEach, beforeEach, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { PgStore } from "../src/store.js";
import { createVerifiedUser } from "./helpers/auth.js";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";

let store: PgStore;
const image = { buffer: Buffer.from("89504e470d0a1a0a01", "hex"), mime: "image/png", name: "fixture.png" };
beforeEach(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 8 });
  const user = await createVerifiedUser(pool, `r_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  store = new PgStore(pool).forUser(user.id);
});
afterEach(async () => { await store.close(); });
async function candidate() { return store.saveCandidate("Candidate", image.buffer, image.mime, image.name); }

// Pause immediately before the first parent lock. Pre-fix code has already read
// membership (or checked draft status); post-fix code has not. SQL still runs on PG.
function gateParent(table: string, draftCheck = false) {
  let release!: () => void, reached!: () => void;
  const ready = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let used = false;
  const query = async (db: Pool | PoolClient, text: string, params?: unknown[]) => {
    const parentLock = text.includes(`FROM ${table} WHERE`) && text.includes("FOR UPDATE");
    const oldDraftCheck = draftCheck && text.startsWith("SELECT status FROM auctions") && !text.includes("FOR UPDATE");
    const oldRename = text.startsWith("UPDATE auctions SET name=");
    if (!used && (parentLock || oldDraftCheck || oldRename)) {
      used = true;
      if (oldDraftCheck) {
        const result = await db.query(text, params); reached(); await gate; return result;
      }
      reached(); await gate;
    }
    return db.query(text, params);
  };
  const pool = store.pool!;
  const gated = {
    query: (text: string, params?: unknown[]) => query(pool, text, params),
    connect: async () => {
      const client = await pool.connect();
      return { query: (text: string, params?: unknown[]) => query(client, text, params), release: () => client.release() };
    },
  };
  return { actor: new PgStore(gated).forUser(store.userId), ready, release };
}

it.each(["list", "auction"] as const)("%s reorder reads membership only after locking, retaining a committed concurrent addition", async kind => {
  const a = await candidate(), b = await candidate(), c = await candidate();
  const parent = kind === "list" ? await store.saveList("List", false) : await store.saveAuction("Draft", null);
  const add = (s: PgStore, id: string) => kind === "list" ? s.addEntryToList(parent.id, id) : s.addEntryToAuction(parent.id, id);
  await add(store, a.id); await add(store, b.id);
  const gate = gateParent(kind === "list" ? "candidate_lists" : "auctions");
  const pending = (kind === "list" ? gate.actor.reorderEntryInList(parent.id, b.id, 0) : gate.actor.reorderEntryInAuction(parent.id, b.id, 0)).catch(error => error);
  try { await gate.ready; await add(store, c.id); }
  finally { gate.release(); }
  expect(await pending).not.toBeInstanceOf(Error);
  const result = kind === "list" ? await store.getList(parent.id) : await store.getAuction(parent.id);
  expect(result.entries).toEqual([b.id, a.id, c.id]);
});

it.each(["list", "auction"] as const)("%s removal and normalization cannot discard a concurrent addition or restore a removed entry", async kind => {
  const a = await candidate(), b = await candidate(), c = await candidate();
  const parent = kind === "list" ? await store.saveList("List", false) : await store.saveAuction("Draft", null);
  const add = (id: string) => kind === "list" ? store.addEntryToList(parent.id, id) : store.addEntryToAuction(parent.id, id);
  await add(a.id); await add(b.id);
  const gate = gateParent(kind === "list" ? "candidate_lists" : "auctions");
  const pending = (kind === "list" ? gate.actor.removeEntryFromList(parent.id, a.id) : gate.actor.removeEntryFromAuction(parent.id, a.id)).catch(error => error);
  try { await gate.ready; await add(c.id); }
  finally { gate.release(); }
  expect(await pending).not.toBeInstanceOf(Error);
  const result = kind === "list" ? await store.getList(parent.id) : await store.getAuction(parent.id);
  expect(result.entries).toEqual([b.id, c.id]);
});

it.each(["list", "auction"] as const)("%s concurrent additions both survive and concurrent removal is not restored by reorder", async kind => {
  const a = await candidate(), b = await candidate(), c = await candidate();
  const parent = kind === "list" ? await store.saveList("List", false) : await store.saveAuction("Draft", null);
  const add = (s: PgStore, id: string) => kind === "list" ? s.addEntryToList(parent.id, id) : s.addEntryToAuction(parent.id, id);
  await add(store, a.id);
  let gate = gateParent(kind === "list" ? "candidate_lists" : "auctions");
  const adding = add(gate.actor, b.id).catch(error => error);
  try { await gate.ready; await add(store, c.id); } finally { gate.release(); }
  expect(await adding).not.toBeInstanceOf(Error);
  const get = () => kind === "list" ? store.getList(parent.id) : store.getAuction(parent.id);
  expect((await get()).entries).toEqual([a.id, c.id, b.id]);
  gate = gateParent(kind === "list" ? "candidate_lists" : "auctions");
  const reorder = (kind === "list" ? gate.actor.reorderEntryInList(parent.id, b.id, 0) : gate.actor.reorderEntryInAuction(parent.id, b.id, 0)).catch(error => error);
  try {
    await gate.ready;
    if (kind === "list") await store.removeEntryFromList(parent.id, a.id);
    else await store.removeEntryFromAuction(parent.id, a.id);
  } finally { gate.release(); }
  expect(await reorder).not.toBeInstanceOf(Error);
  expect((await get()).entries).toEqual([b.id, c.id]);
});

it("forking and draft entry edits see source membership committed before the source lock, without borrowing a nested pool client", async () => {
  const a = await candidate(), b = await candidate();
  const source = await store.saveList("Source", false);
  await store.addEntryToList(source.id, a.id);
  const draft = await store.saveAuction("Draft", source.id);
  const gate = gateParent("auctions");
  const rename = gate.actor.renameAuction(draft.id, "Forked").catch(error => error);
  try { await gate.ready; await store.addEntryToList(source.id, b.id); } finally { gate.release(); }
  expect(await rename).toMatchObject({ followsSource: false, entries: [a.id, b.id] });
  const singlePool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1, connectionTimeoutMillis: 1000 });
  const single = new PgStore(singlePool).forUser(store.userId);
  try {
    const following = await single.saveAuction("One client", source.id);
    const replacement = await single.editDraftEntryCandidate(following.id, a.id, "Replacement", null);
    expect((await single.getAuction(following.id)).entries).toEqual([replacement.id, b.id]);
    expect((await single.renameAuction(following.id, "Renamed")).name).toBe("Renamed");
    expect((await single.setSimulationPromptTemplate(following.id, "Template")).simulationPromptTemplate).toBe("Template");
    await single.removeEntryFromAuction(following.id, b.id);
    await single.addEntryToAuction(following.id, b.id);
    expect((await single.reorderEntryInAuction(following.id, b.id, 0)).entries).toEqual([b.id, replacement.id]);
  } finally { await single.close(); }
});

async function readyDraft() {
  const source = await store.saveList("Source", false);
  for (let i = 0; i < 4; i++) await store.addEntryToList(source.id, (await candidate()).id);
  const draft = await store.saveAuction("Before", source.id);
  const field = await store.battlefields.create({ name: "Field", geography: "Geo", history: "Past" }, image);
  await store.setAuctionBattlefield(draft.id, field.id);
  const teams = [0, 1].map(position => {
    const team = createAuctionTeam(draft.id, `Team ${position}`, position as 0 | 1, { flag: image });
    addTeamMember(team, "Member", 100);
    return team;
  });
  await store.teams.saveAuctionTeams(draft.id, teams);
  return draft;
}

it.each(["name", "template", "add", "remove", "reorder", "edit"])("start winning the lock rejects a delayed %s operation without changing preparation", async operation => {
  const draft = await readyDraft();
  if (operation === "name") await store.renameAuction(draft.id, "Before");
  const extra = await candidate();
  const gate = gateParent("auctions", operation !== "name");
  const pending = (operation === "name" ? gate.actor.renameAuction(draft.id, "After")
    : operation === "template" ? gate.actor.setSimulationPromptTemplate(draft.id, "After")
    : operation === "add" ? gate.actor.addEntryToAuction(draft.id, extra.id)
    : operation === "remove" ? gate.actor.removeEntryFromAuction(draft.id, draft.entries[0])
    : operation === "edit" ? gate.actor.editDraftEntryCandidate(draft.id, draft.entries[0], "After", null)
    : gate.actor.reorderEntryInAuction(draft.id, draft.entries[0], 3)).catch(error => error);
  try { await gate.ready; await store.startAuction(draft.id); }
  finally { gate.release(); }
  expect(await pending).toMatchObject({ message: "preparation locked" });
  expect(await store.getAuction(draft.id)).toMatchObject({ name: "Before", simulationPromptTemplate: "", entries: draft.entries, status: "ongoing", followsSource: false });
});
