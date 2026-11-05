import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { PgStore } from "../src/store.js";
import { AccessError } from "../src/access.js";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";
import { authenticatedClient, createVerifiedUser } from "./helpers/auth.js";

describe("domain ownership", () => {
  const schema = `access_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, root: PgStore, a: PgStore, b: PgStore, server: Server, base: string;
  let alice: Awaited<ReturnType<typeof authenticatedClient>>, bob: typeof alice;
  const origin = "http://localhost:5173";
  const image = { buffer: Buffer.from("89504e470d0a1a0a", "hex"), mime: "image/png", name: "flag.png" };
  const fields = { name: "Field", geography: "Plain", history: "History" };
  const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const multipart = (values: Record<string, string> = {}): RequestInit => {
    const form = new FormData();
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    form.set("image", new Blob([image.buffer], { type: image.mime }), image.name);
    return { body: form };
  };
  async function seed(store: PgStore) {
    const candidates = await Promise.all(Array.from({ length: 4 }, (_, i) => store.saveCandidate(`Candidate ${i}`, image.buffer, image.mime, image.name)));
    const list = await store.saveList("List", false);
    for (const candidate of candidates) await store.addEntryToList(list.id, candidate.id);
    const auction = await store.saveAuction("Draft", list.id);
    const field = await store.battlefields.create(fields, image);
    await store.battlefields.select(auction.id, field.id);
    const teamList = [0, 1].map(position => {
      const team = createAuctionTeam(auction.id, `Team ${position}`, position as 0 | 1, { flag: image, slogan: "Together" });
      addTeamMember(team, "Member", 10, { avatar: image });
      return team;
    });
    const teams = await store.teams.saveAuctionTeams(auction.id, teamList);
    const upload = await store.teams.saveTeamImageUpload(auction.id, image);
    const live = await store.cloneAuction(auction.id, "Live");
    await store.startAuction(live.id);
    await store.live.sendNext(live.id);
    return { candidates, list, auction, field, teams, upload, live };
  }
  let fa: Awaited<ReturnType<typeof seed>>, fb: typeof fa;
  beforeAll(async () => {
    const value = process.env.AUTH_TEST_DATABASE_URL;
    if (!value || !/^\/[^/]*(?:test|disposable)[^/]*$/i.test(new URL(value).pathname)) throw new Error("Explicit disposable AUTH_TEST_DATABASE_URL required");
    admin = new Pool({ connectionString: value });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString(), max: 4, application_name: schema });
    await pool.query(await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8"));
    const ua = await createVerifiedUser(pool, "alice"), ub = await createVerifiedUser(pool, "bob");
    root = new PgStore(pool);
    const app = buildApp(root, { allowedOrigin: origin });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    alice = await authenticatedClient(base, { login: "alice", password: "fixture-password" }, origin);
    bob = await authenticatedClient(base, { login: "bob", password: "fixture-password" }, origin);
    a = root.forUser(ua.id); b = root.forUser(ub.id);
    fa = await seed(a); fb = await seed(b);
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  it("requires a session on domain reads", async () => {
    for (const path of ["/candidates", "/lists", "/auctions", "/battlefields", "/auctions/missing/background", "/auctions/missing/live"]) {
      expect((await fetch(base + path)).status, path).toBe(401);
    }
    const bootstrap = await fetch(base + "/auth/session");
    const { csrfToken } = await bootstrap.json();
    const cookie = bootstrap.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    for (const path of ["/candidates", "/lists", "/auctions", "/battlefields"]) {
      expect((await fetch(base + path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": csrfToken } })).status).toBe(401);
    }
  });

  it.each(["text/html", "image/svg+xml", "image/png"])("all binary families preserve legacy unsafe bytes but never serve executable content (%s)", async mime => {
    const fixture = await seed(a);
    const { candidates: [candidate], field, auction, teams: [team], upload } = fixture;
    const member = team.members[0];
    const bytes = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>");
    await pool.query("UPDATE candidates SET image=$2,image_mime=$3 WHERE id=$1", [candidate.id, bytes, mime]);
    await pool.query("UPDATE battlefields SET image=$2,image_mime=$3 WHERE id=$1", [field.id, bytes, mime]);
    await pool.query("UPDATE auctions SET battlefield_image=$2,battlefield_image_mime=$3,battlefield_image_name='legacy',background_image=$2,background_mime=$3,background_name='legacy' WHERE id=$1", [auction.id, bytes, mime]);
    await pool.query("UPDATE auction_team_image_uploads SET image=$2,image_mime=$3 WHERE id=$1", [upload.id, bytes, mime]);
    await pool.query("UPDATE auction_teams SET flag_image=$2,flag_mime=$3 WHERE id=$1", [team.id, bytes, mime]);
    await pool.query("UPDATE auction_team_members SET avatar_image=$2,avatar_mime=$3 WHERE id=$1", [member.id, bytes, mime]);
    const paths = [`/candidates/${candidate.id}/image`, `/battlefields/${field.id}/image`, `/auctions/${auction.id}/battlefield/image`, `/auctions/${auction.id}/background`, `/auctions/${auction.id}/team-images/${upload.id}/image`, `/auctions/${auction.id}/teams/${team.id}/flag`, `/auctions/${auction.id}/teams/${team.id}/members/${member.id}/avatar`];
    for (const path of paths) {
      const response = await alice(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toBe("application/octet-stream");
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(response.headers.get("content-security-policy"), path).toBe("sandbox; default-src 'none'");
      expect(response.headers.get("content-disposition"), path).toBe("attachment");
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expect(Buffer.from(await response.arrayBuffer()), path).toEqual(bytes);
      const head = await alice(path, { method: "HEAD" });
      expect(head.headers.get("content-type"), path).toBe("application/octet-stream");
      expect(head.headers.get("content-security-policy"), path).toContain("sandbox");
    }
    expect((await a.getCandidate(candidate.id)).image).toEqual(bytes);
    expect((await a.battlefields.get(field.id)).image.buffer).toEqual(bytes);
    expect((await a.battlefields.getDraftBattlefieldImage(auction.id)).buffer).toEqual(bytes);
    expect((await a.battlefields.getBackground(auction.id))!.buffer).toEqual(bytes);
    expect((await a.teams.getTeamImageUpload(upload.id)).buffer).toEqual(bytes);
    expect((await a.teams.getTeamFlagImage(team.id)).buffer).toEqual(bytes);
    expect((await a.teams.getMemberAvatarImage(member.id))!.buffer).toEqual(bytes);
  });
  it("fails closed without a scope and keeps scopes independent", async () => {
    await expect(root.listAuctions()).rejects.toThrow();
    const own = await a.saveAuction("Alice", null);
    expect((await a.listAuctions()).map(x => x.id)).toContain(own.id);
    expect((await b.listAuctions()).map(x => x.id)).not.toContain(own.id);
    await expect(b.getAuction(own.id)).rejects.toThrow();
    expect(() => root.teams).toThrow();
    expect(() => root.live).toThrow();
    expect(() => root.battlefields).toThrow();
    expect(() => { (a as { userId: string }).userId = b.userId; }).toThrow();
    expect(a.forUser(b.userId)).not.toBe(a);
    const candidate = fa.candidates[0].id, list = fa.list.id, auction = fa.auction.id;
    const operations = [
      () => root.saveCandidate("Root", image.buffer, image.mime, image.name), () => root.getCandidate(candidate),
      () => root.listCandidates(), () => root.archiveCandidate(candidate), () => root.isCandidateReferenced(candidate),
      () => root.editCatalogCandidate(candidate, "Root", null), () => root.saveList("Root", false),
      () => root.getList(list), () => root.listLists(), () => root.archiveList(list), () => root.cloneList(list),
      () => root.editListEntryCandidate(list, candidate, "Root", null), () => root.addEntryToList(list, candidate),
      () => root.removeEntryFromList(list, candidate), () => root.reorderEntryInList(list, candidate, 1),
      () => root.saveAuction("Root", null), () => root.getAuction(auction), () => root.cloneAuction(auction),
      () => root.renameAuction(auction, "Root"), () => root.setSimulationPromptTemplate(auction, "Root"),
      () => root.deleteDraftAuction(auction), () => root.startAuction(auction), () => root.setAuctionBattlefield(auction, null),
      () => root.editDraftEntryCandidate(auction, candidate, "Root", null), () => root.addEntryToAuction(auction, candidate),
      () => root.removeEntryFromAuction(auction, candidate), () => root.reorderEntryInAuction(auction, candidate, 1),
    ];
    for (const operation of operations) await expect(operation()).rejects.toBeInstanceOf(AccessError);
  });
  it("hides private records and ignores owner spoofing under mixed concurrency", async () => {
    const other = await b.saveAuction("Bob", null);
    const response = await alice("/auctions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "owned", ownerUserId: b.userId, owner_user_id: b.userId }) });
    expect(response.status).toBe(201);
    const own = await response.json();
    for (const [method, path] of [["GET", ""], ["GET", "/background"], ["GET", "/battlefield/image"], ["GET", "/teams"], ["GET", "/live"], ["POST", "/clone"], ["POST", "/start"], ["POST", "/live/undo"], ["DELETE", ""]]) {
      expect((await bob(`/auctions/${own.id}${path}`, { method })).status, `${method} ${path}`).toBe(404);
    }
    await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const [client, id, foreign] = i % 2 ? [alice, own.id, other.id] : [bob, other.id, own.id];
      expect((await client(`/auctions/${id}`)).status).toBe(200);
      expect((await client(`/auctions/${foreign}`)).status).toBe(404);
      const list = await client("/auctions");
      expect(list.headers.get("cache-control")).toBe("no-store");
      expect((await list.json()).map((x: { id: string }) => x.id)).not.toContain(foreign);
    }));
  });
  it("protects every domain method in both directions, including anonymous CSRF-valid writes", async () => {
    const bootstrap = await fetch(base + "/auth/session");
    const { csrfToken } = await bootstrap.json();
    const cookie = bootstrap.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    for (const [client, fixture] of [[bob, fa], [alice, fb]] as const) {
      const { candidates: [candidate], list, auction, field, teams, upload, live } = fixture;
      const team = teams[0], member = team.members[0];
      const teamPayload = { teams: teams.map(t => ({ name: t.name, slogan: t.slogan, position: t.position,
        flag: { data: image.buffer.toString("base64"), mime: image.mime, name: image.name },
        members: [{ name: "Member", initialGold: 10, avatar: null }] })) };
      const cases: [string, string, (() => RequestInit)?][] = [
        ["GET", `/candidates/${candidate.id}`], ["GET", `/candidates/${candidate.id}/image`],
        ["HEAD", `/candidates/${candidate.id}/image`],
        ["POST", `/candidates/${candidate.id}/archive`], ["POST", `/candidates/${candidate.id}/edit`, () => multipart({ name: "Edited" })],
        ["GET", `/lists/${list.id}`], ["POST", `/lists/${list.id}/entries`, () => json({ candidateId: candidate.id })],
        ["PATCH", `/lists/${list.id}`, () => json({ isPublic: true })],
        ["DELETE", `/lists/${list.id}/entries/${candidate.id}`], ["POST", `/lists/${list.id}/reorder`, () => json({ candidateId: candidate.id, toIndex: 1 })],
        ["POST", `/lists/${list.id}/archive`], ["POST", `/lists/${list.id}/clone`],
        ["POST", `/lists/${list.id}/entries/${candidate.id}/edit`, () => multipart({ name: "Edited" })],
        ["GET", `/auctions/${auction.id}`], ["DELETE", `/auctions/${auction.id}`],
        ["PATCH", `/auctions/${auction.id}`, () => json({ name: "Edited", battlefieldId: field.id })],
        ["POST", `/auctions/${auction.id}/clone`, () => json({ name: "Clone" })], ["POST", `/auctions/${auction.id}/start`],
        ["POST", `/auctions/${auction.id}/entries`, () => json({ candidateId: candidate.id })],
        ["DELETE", `/auctions/${auction.id}/entries/${candidate.id}`],
        ["POST", `/auctions/${auction.id}/reorder`, () => json({ candidateId: candidate.id, toIndex: 1 })],
        ["POST", `/auctions/${auction.id}/entries/${candidate.id}/edit`, () => multipart({ name: "Edited" })],
        ["GET", `/battlefields/${field.id}`], ["GET", `/battlefields/${field.id}/image`],
        ["HEAD", `/battlefields/${field.id}/image`],
        ["POST", `/battlefields/${field.id}/edit`, () => multipart(fields)], ["POST", `/battlefields/${field.id}/archive`],
        ["GET", `/auctions/${auction.id}/battlefield`], ["GET", `/auctions/${auction.id}/battlefield/image`],
        ["HEAD", `/auctions/${auction.id}/battlefield/image`],
        ["POST", `/auctions/${auction.id}/battlefield`, () => multipart({ geography: "Changed" })],
        ["GET", `/auctions/${auction.id}/background`], ["DELETE", `/auctions/${auction.id}/background`],
        ["HEAD", `/auctions/${auction.id}/background`],
        ["POST", `/auctions/${auction.id}/background`, multipart],
        ["GET", `/auctions/${auction.id}/teams`], ["POST", `/auctions/${auction.id}/teams`, () => json(teamPayload)],
        ["POST", `/auctions/${auction.id}/team-images`, multipart],
        ["GET", `/auctions/${auction.id}/team-images/${upload.id}/image`],
        ["HEAD", `/auctions/${auction.id}/team-images/${upload.id}/image`],
        ["GET", `/auctions/${auction.id}/teams/${team.id}/flag`],
        ["HEAD", `/auctions/${auction.id}/teams/${team.id}/flag`],
        ["GET", `/auctions/${auction.id}/teams/${team.id}/members/${member.id}/avatar`],
        ["HEAD", `/auctions/${auction.id}/teams/${team.id}/members/${member.id}/avatar`],
        ["GET", `/auctions/${live.id}/live`],
        ...["next", "pass", "sale", "end", "undo"].map(action => ["POST", `/auctions/${live.id}/live/${action}`] as [string, string]),
        ["POST", `/auctions/${live.id}/live/bids`, () => json({ team: 0, contributions: [1] })],
      ];
      for (const [method, path, init = () => ({})] of cases) {
        const response = await client(path, { ...init(), method });
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(response.headers.get("cache-control"), path).toBe("no-store");
        const anonymous: RequestInit = init();
        const headers = new Headers(anonymous.headers);
        headers.set("Origin", origin); headers.set("Cookie", cookie); headers.set("X-CSRF-Token", csrfToken);
        expect((await fetch(base + path, { ...anonymous, method, headers })).status, `anonymous ${method} ${path}`).toBe(401);
      }
    }
    expect((await a.getAuction(fa.auction.id)).name).toBe("Draft");
    expect((await b.getAuction(fb.auction.id)).name).toBe("Draft");
    expect((await a.live.getLive(fa.live.id)).canUndo).toBe(true);
    expect((await b.live.getLive(fb.live.id)).active).toBe(true);
  });
  it("isolates catalogs, candidates, list sources and battlefield selection", async () => {
    for (const [client, store, own, foreign] of [[alice, a, fa, fb], [bob, b, fb, fa]] as const) {
      for (const [path, ownId, foreignId] of [["/candidates", own.candidates[0].id, foreign.candidates[0].id], ["/lists", own.list.id, foreign.list.id], ["/battlefields", own.field.id, foreign.field.id]]) {
        const response = await client(path);
        const ids = (await response.json()).map((x: { id: string }) => x.id);
        expect(ids).toContain(ownId); expect(ids).not.toContain(foreignId);
      }
      for (const path of [`/lists/${own.list.id}/entries`, `/auctions/${own.auction.id}/entries`]) {
        expect((await client(path, { method: "POST", ...json({ candidateId: foreign.candidates[0].id }) })).status).toBe(404);
      }
      expect((await client("/auctions", { method: "POST", ...json({ name: "Stolen", sourceListId: foreign.list.id }) })).status).toBe(404);
      expect((await client(`/auctions/${own.auction.id}`, { method: "PATCH", ...json({ battlefieldId: foreign.field.id }) })).status).toBe(404);
      await expect(store.getCandidate(foreign.candidates[0].id)).rejects.toThrow();
      await expect(store.teams.getTeamImageUpload(foreign.upload.id)).rejects.toThrow();
      await expect(store.teams.getTeamFlagImage(foreign.teams[0].id)).rejects.toThrow();
      await expect(store.teams.getMemberAvatarImage(foreign.teams[0].members[0].id)).rejects.toThrow();
    }
  });
  it("validates nested parent IDs and refuses foreign image reuse", async () => {
    for (const [client, own, foreign] of [[alice, fa, fb], [bob, fb, fa]] as const) {
      const other = await (client === alice ? a : b).saveAuction("Other draft", null);
      for (const path of [
        `/auctions/${own.auction.id}/team-images/${foreign.upload.id}/image`,
        `/auctions/${other.id}/team-images/${own.upload.id}/image`,
        `/auctions/${other.id}/teams/${own.teams[0].id}/flag`,
        `/auctions/${own.auction.id}/teams/${foreign.teams[0].id}/flag`,
        `/auctions/${own.auction.id}/teams/${own.teams[0].id}/members/${foreign.teams[0].members[0].id}/avatar`,
        `/auctions/${own.auction.id}/teams/${own.teams[1].id}/members/${own.teams[0].members[0].id}/avatar`,
      ]) expect((await client(path)).status, path).toBe(404);
      for (const reference of [{ uploadId: foreign.upload.id }, { teamId: foreign.teams[0].id }, { memberId: foreign.teams[0].members[0].id }]) {
        const teams = own.teams.map(t => ({ name: t.name, slogan: t.slogan, position: t.position, flag: reference, members: [{ name: "M", initialGold: 10, avatar: null }] }));
        expect((await client(`/auctions/${own.auction.id}/teams`, { method: "POST", ...json({ teams }) })).status, JSON.stringify(reference)).toBe(404);
      }
    }
  });
  it("ignores spoofed owners and sharing flags on all creation routes", async () => {
    for (const [client, owner, other] of [[alice, a, b], [bob, b, a]] as const) {
      const spoof = { ownerUserId: other.userId, userId: other.userId, owner_user_id: other.userId, is_public: true };
      const forms = [
        ["/candidates", multipart({ name: "Created", ...Object.fromEntries(Object.entries(spoof).map(([k,v]) => [k, String(v)])) }), "candidates"],
        ["/battlefields", multipart({ ...fields, ...Object.fromEntries(Object.entries(spoof).map(([k,v]) => [k, String(v)])) }), "battlefields"],
        ["/lists", json({ name: "Created", isDraft: false, ...spoof }), "candidate_lists"],
        ["/auctions", json({ name: "Created", ...spoof }), "auctions"],
      ] as const;
      for (const [path, init, table] of forms) {
        const response = await client(path, { method: "POST", ...init });
        expect(response.status, path).toBe(201);
        const { id } = await response.json();
        const saved = await pool.query(`SELECT owner_user_id${table === "auctions" ? "" : ", is_public"} FROM ${table} WHERE id=$1`, [id]);
        expect(saved.rows[0].owner_user_id).toBe(owner.userId);
        if (table !== "auctions") expect(saved.rows[0].is_public).toBe(false);
      }
    }
  });
  it("isolates simultaneous creates, renames, clones, images, bids and undo on one pool", async () => {
    await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const [client, foreignClient, store, own, foreign] = i % 2 ? [alice, bob, a, fa, fb] as const : [bob, alice, b, fb, fa] as const;
      const created = await client("/auctions", { method: "POST", ...json({ name: `Concurrent ${i}` }) });
      expect(created.status).toBe(201);
      const { id } = await created.json();
      const results = await Promise.all([
        client(`/auctions/${id}`, { method: "PATCH", ...json({ name: `Renamed ${i}` }) }),
        client(`/auctions/${own.auction.id}/clone`, { method: "POST", ...json({ name: `Copy ${i}` }) }),
        client(`/candidates/${own.candidates[0].id}/image`),
        foreignClient(`/auctions/${id}`, { method: "PATCH", ...json({ name: "Stolen" }) }),
        client(`/auctions/${foreign.auction.id}/clone`, { method: "POST" }),
      ]);
      expect(results.map(r => r.status)).toEqual([200, 201, 200, 404, 404]);
      expect((await store.getAuction(id)).name).toBe(`Renamed ${i}`);
    }));
    await Promise.all(([[alice, fa, 1], [bob, fb, 2]] as const).map(async ([client, fixture, amount]) => {
      const bid = await client(`/auctions/${fixture.live.id}/live/bids`, { method: "POST", ...json({ team: 0, contributions: [amount] }) });
      expect(bid.status).toBe(200);
      expect((await bid.json()).latest.amount).toBe(amount);
      const undo = await client(`/auctions/${fixture.live.id}/live/undo`, { method: "POST" });
      expect(undo.status).toBe(200); expect((await undo.json()).latest).toBeNull();
    }));
  });
  it("rechecks ownership inside transactions after waiting for a concurrent owner change", async () => {
    const operations: ((id: string) => Promise<unknown>)[] = [
      id => a.cloneAuction(id), id => a.startAuction(id), id => a.teams.saveAuctionTeams(id, []),
      id => a.teams.saveTeamImageUpload(id, image), id => a.battlefields.setBackground(id, image),
      id => a.addEntryToAuction(id, fa.candidates[0].id), id => a.live.undo(id),
    ];
    for (const operation of operations) {
      const target = await a.saveAuction("Concurrent ownership", null);
      const lock = await pool.connect();
      try {
        await lock.query("BEGIN");
        await lock.query("UPDATE auctions SET owner_user_id=$2 WHERE id=$1 AND owner_user_id=$3", [target.id, b.userId, a.userId]);
        const mutation = operation(target.id);
        // Attach the rejection handler immediately while the query is blocked.
        const rejected = expect(mutation).rejects.toThrow("not found");
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema]);
          if (waiting.rows.length) { blocked = true; break; }
          await setTimeout(10);
        }
        expect(blocked).toBe(true);
        await lock.query("COMMIT");
        await rejected;
        expect((await b.getAuction(target.id)).status).toBe("draft");
        expect(await b.teams.getAuctionTeams(target.id)).toEqual([]);
        expect(await b.battlefields.getBackground(target.id)).toBeNull();
      } finally { await lock.query("ROLLBACK").catch(() => undefined); lock.release(); }
    }
  });
});
