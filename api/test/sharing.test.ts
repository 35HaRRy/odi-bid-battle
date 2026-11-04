import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { PgStore } from "../src/store.js";
import { AccessError } from "../src/access.js";
import { buildApp } from "../src/app.js";
import { fixtureClient, fixtureOrigin, ownedStore } from "./helpers/domain.js";
import { createVerifiedUser } from "./helpers/auth.js";
import { randomUUID } from "node:crypto";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";

describe("opt-in sharing", () => {
  let a: PgStore, b: PgStore, server: Server;
  let request: Awaited<ReturnType<typeof fixtureClient>>;
  const image = { buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), mime: "image/png", name: "old.png" };
  const fields = { name: "Old field", geography: "Old geography", history: "Old history" };
  const candidate = (store: PgStore, name = "Old candidate", isPublic = false) =>
    store.saveCandidate(name, image.buffer, image.mime, image.name, isPublic);

  beforeEach(async () => {
    a = await ownedStore(process.env.DATABASE_URL!);
    const user = await createVerifiedUser(a.pool!, `s_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
    b = a.forUser(user.id);
    server = createServer(buildApp(a, { allowedOrigin: fixtureOrigin }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    request = await fixtureClient(`http://127.0.0.1:${address.port}`, b);
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await a.close();
  });

  it("defaults to own roots and unions public roots without duplicates, with Visibility", async () => {
    const c = await candidate(a, "Public", true);
    const privateCandidate = await candidate(a);
    const own = await candidate(b, "Own public", true);
    const list = await a.saveList("Public list", false, true);
    const field = await a.battlefields.create(fields, image, true);
    expect((await b.listCandidates()).map((r) => r.id)).toEqual([own.id]);
    const visible = await b.listCandidates(true);
    expect(visible.map((r) => r.id)).toContain(c.id);
    expect(visible.map((r) => r.id)).not.toContain(privateCandidate.id);
    expect(visible.filter((r) => r.id === own.id)).toHaveLength(1);
    expect(visible.find((r) => r.id === c.id)).toMatchObject({ ownerUserId: a.userId, isOwner: false, isPublic: true });
    expect(await b.listLists()).toEqual([]);
    expect((await b.listLists(true)).map((r) => r.id)).toContain(list.id);
    expect(await b.battlefields.list()).toEqual([]);
    expect((await b.battlefields.list(true)).map((r) => r.id)).toContain(field.id);
  });

  it("public-list private children need exact context for detail and image", async () => {
    const c = await candidate(a);
    const list = await a.saveList("Public", false, true);
    await a.addEntryToList(list.id, c.id);
    const unrelated = await b.saveList("Unrelated", false);
    const foreignAuction = await a.saveAuction("Private auction", list.id);
    for (const suffix of ["", "/image"]) {
      expect((await request(`/candidates/${c.id}${suffix}`)).status).toBe(404);
      expect((await request(`/candidates/${c.id}${suffix}?listId=${list.id}`)).status).toBe(200);
      expect((await request(`/candidates/${c.id}${suffix}?listId=${unrelated.id}`)).status).toBe(404);
      expect((await request(`/candidates/${c.id}${suffix}?auctionId=${foreignAuction.id}`)).status).toBe(404);
      expect((await request(`/candidates/${c.id}${suffix}?listId=${list.id}&auctionId=${foreignAuction.id}`)).status).toBe(400);
      expect((await request(`/candidates/${c.id}${suffix}?listId=${list.id}&listId=${list.id}`)).status).toBe(400);
    }
    await expect(b.addEntryToList(unrelated.id, c.id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.addEntryToList(unrelated.id, c.id, unrelated.id)).rejects.toBeInstanceOf(AccessError);
    await b.addEntryToList(unrelated.id, c.id, list.id);
    await expect(b.getCandidate(c.id)).rejects.toBeInstanceOf(AccessError);
    expect((await b.getCandidate(c.id, { listId: unrelated.id })).name).toBe(c.name);
  });

  it("rejects nonowner edits/archive/reorder and clones public lists as own private", async () => {
    const c = await candidate(a, "Public", true);
    const list = await a.saveList("Public list", false, true);
    await a.addEntryToList(list.id, c.id);
    const field = await a.battlefields.create(fields, image, true);
    await expect(b.editCatalogCandidate(c.id, "bad", null, false)).rejects.toBeInstanceOf(AccessError);
    await expect(b.archiveCandidate(c.id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.archiveList(list.id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.editList(list.id, "bad", false)).rejects.toBeInstanceOf(AccessError);
    await expect(b.reorderEntryInList(list.id, c.id, 0)).rejects.toBeInstanceOf(AccessError);
    await expect(b.removeEntryFromList(list.id, c.id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.editListEntryCandidate(list.id, c.id, "bad", null)).rejects.toBeInstanceOf(AccessError);
    await expect(b.addEntryToList(list.id, c.id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.battlefields.edit(field.id, fields, null)).rejects.toBeInstanceOf(AccessError);
    await expect(b.battlefields.archive(field.id)).rejects.toBeInstanceOf(AccessError);
    const clone = await b.cloneList(list.id);
    expect(clone).toMatchObject({ ownerUserId: b.userId, isOwner: true, isPublic: false, entries: [c.id] });
    for (const [path, init] of [
      [`/lists/${list.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPublic: false }) }],
      [`/lists/${list.id}/archive`, { method: "POST" }],
      [`/candidates/${c.id}/archive`, { method: "POST" }],
      [`/battlefields/${field.id}/archive`, { method: "POST" }],
    ] as const) expect((await request(path, init)).status).toBe(404);
  });

  it("source_revocation_preserves_existing_reference_only; later_private_edit_is_not_visible_to_previous_consumer", async () => {
    const c = await candidate(a, "Original", true);
    const list = await b.saveList("Consumer", false);
    await b.addEntryToList(list.id, c.id);
    const replacement = await a.editCatalogCandidate(c.id, "Private replacement", null, false);
    expect(replacement.id).not.toBe(c.id);
    expect(replacement.isPublic).toBe(false);
    await a.archiveCandidate(c.id);
    expect((await b.getCandidate(c.id, { listId: list.id })).name).toBe("Original");
    await expect(b.getCandidate(c.id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.getCandidate(replacement.id, { listId: list.id })).rejects.toBeInstanceOf(AccessError);
    const nextList = await b.saveList("New consumer", false);
    await expect(b.addEntryToList(nextList.id, c.id)).rejects.toBeInstanceOf(AccessError);
    await b.reorderEntryInList(list.id, c.id, 0);
  });

  it("foreign_list_draft_is_detached and private children survive public-to-private list changes", async () => {
    const c = await candidate(a);
    const source = await a.saveList("Source", false, true);
    await a.addEntryToList(source.id, c.id);
    const draft = await b.saveAuction("Consumer", source.id);
    const clone = await b.cloneList(source.id);
    const ownDraft = await a.saveAuction("Own follower", source.id);
    expect(draft).toMatchObject({ sourceListId: null, followsSource: false, entries: [c.id] });
    await a.editList(source.id, "Hidden", false);
    const edited = await a.editListEntryCandidate(source.id, c.id, "Later", null);
    expect((await a.getAuction(ownDraft.id)).entries).toEqual([edited.id]);
    expect((await b.getAuction(draft.id)).entries).toEqual([c.id]);
    expect((await b.getCandidate(c.id, { auctionId: draft.id })).name).toBe("Old candidate");
    expect((await b.getCandidate(c.id, { listId: clone.id })).name).toBe("Old candidate");
    await expect(b.saveAuction("Denied", source.id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.addEntryToAuction(draft.id, edited.id, source.id)).rejects.toBeInstanceOf(AccessError);
    await b.reorderEntryInAuction(draft.id, c.id, 0);
  });

  it("foreign_candidate_edit_creates_own_private_copy in list and draft without archiving source", async () => {
    const c = await candidate(a, "Public", true);
    const list = await b.saveList("Consumer", false);
    await b.addEntryToList(list.id, c.id);
    const draft = await b.saveAuction("Draft", null);
    await b.addEntryToAuction(draft.id, c.id);
    const copy = await b.editListEntryCandidate(list.id, c.id, "Mine", null);
    const draftCopy = await b.editDraftEntryCandidate(draft.id, c.id, "Mine draft", null);
    for (const r of [copy, draftCopy]) expect(r).toMatchObject({ ownerUserId: b.userId, isOwner: true, isPublic: false });
    expect((await a.getCandidate(c.id)).archivedAt).toBeNull();
    expect((await a.getCandidate(c.id)).name).toBe("Public");
  });

  it("battlefield selected versions survive hide/archive/edit, but new selection is denied", async () => {
    const field = await a.battlefields.create(fields, image, true);
    const draft = await b.saveAuction("Consumer", null);
    await b.battlefields.select(draft.id, field.id);
    const replacement = await a.battlefields.edit(field.id, { ...fields, name: "New", geography: "New geography" }, null, false);
    expect(replacement.id).not.toBe(field.id);
    expect(replacement.isPublic).toBe(false);
    await a.battlefields.archive(field.id);
    expect(await b.battlefields.getDraftBattlefield(draft.id)).toMatchObject({ name: fields.name, geography: fields.geography });
    expect((await b.battlefields.getDraftBattlefieldImage(draft.id)).buffer).toEqual(image.buffer);
    await expect(b.battlefields.get(field.id)).rejects.toBeInstanceOf(AccessError);
    const another = await b.saveAuction("New", null);
    await expect(b.battlefields.select(another.id, field.id)).rejects.toBeInstanceOf(AccessError);
    await b.battlefields.saveDraftBattlefield(draft.id, { geography: "Mine", history: "Mine history" }, undefined);
    const cloned = await b.cloneAuction(draft.id);
    expect((await b.battlefields.getDraftBattlefield(cloned.id))?.geography).toBe("Mine");
  });

  it("keeps foreign candidate and battlefield versions through start, sales, history and clone", async () => {
    const source = await a.saveList("Shared roster", false, true);
    const candidates = [];
    for (let i = 0; i < 4; i++) {
      const c = await candidate(a, `Historical ${i}`);
      candidates.push(c);
      await a.addEntryToList(source.id, c.id);
    }
    const draft = await b.saveAuction("History", source.id);
    const field = await a.battlefields.create(fields, image, true);
    await b.battlefields.select(draft.id, field.id);
    const teams = [0, 1].map((position) => {
      const team = createAuctionTeam(draft.id, `Team ${position}`, position as 0 | 1, { flag: image, slogan: "Together" });
      addTeamMember(team, "Member", 1);
      return team;
    });
    await b.teams.saveAuctionTeams(draft.id, teams);
    await a.editList(source.id, "Hidden", false);
    await a.editCatalogCandidate(candidates[0].id, "Later private candidate", null, false);
    await a.battlefields.edit(field.id, { ...fields, name: "Later private field" }, null, false);
    await b.startAuction(draft.id);
    for (const team of [0, 1] as const) {
      await b.live.sendNext(draft.id);
      await b.live.confirmBid(draft.id, team, [1]);
      await b.live.sell(draft.id);
    }
    const completed = await b.live.endAuction(draft.id);
    expect(completed.teams[0].acquired[0].name).toBe("Historical 0");
    expect(completed.battlefield?.name).toBe(fields.name);
    const cloned = await b.cloneAuction(draft.id);
    expect(cloned.entries).toEqual(candidates.map((c) => c.id));
    for (const auctionId of [draft.id, cloned.id]) {
      expect((await b.getCandidate(candidates[0].id, { auctionId })).image).toEqual(image.buffer);
      expect((await b.battlefields.getDraftBattlefieldImage(auctionId)).buffer).toEqual(image.buffer);
      expect((await request(`/candidates/${candidates[0].id}/image?auctionId=${auctionId}`)).status).toBe(200);
    }
    await expect(b.getCandidate(candidates[0].id)).rejects.toBeInstanceOf(AccessError);
    await expect(b.editDraftEntryCandidate(draft.id, candidates[0].id, "Locked", null)).rejects.toThrow("preparation locked");
  });

  it("strict HTTP sharing booleans preserve omitted edit values", async () => {
    const publicCandidate = await candidate(a, "Public", true);
    for (const value of ["false", "1", "TRUE", "true&includePublic=true"]) {
      const response = await request(`/candidates?includePublic=${value}`);
      expect((await response.json()).map((r: { id: string }) => r.id)).not.toContain(publicCandidate.id);
    }
    expect((await (await request("/candidates?includePublic=true")).json()).map((r: { id: string }) => r.id)).toContain(publicCandidate.id);
    for (const value of [false, "false", "on", 1]) {
      const response = await request("/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Private", isDraft: false, isPublic: value }) });
      expect((await response.json()).isPublic).toBe(false);
    }
    const list = await b.saveList("Public", false, true);
    const hidden = await request(`/lists/${list.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isPublic: false }) });
    expect((await hidden.json()).isPublic).toBe(false);
    await b.editList(list.id, "Public again", true);
    expect((await b.editList(list.id, "Still public")).isPublic).toBe(true);
    const own = await candidate(b, "Own", true);
    expect((await b.editCatalogCandidate(own.id, "Still public", null)).isPublic).toBe(true);
    const field = await b.battlefields.create(fields, image, true);
    expect((await b.battlefields.edit(field.id, fields, null)).isPublic).toBe(true);
  });
});
