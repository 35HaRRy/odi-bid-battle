import { describe, expect, it } from "vitest";
import { PgStore } from "../src/store.js";
import { fixtureClient, fixtureOrigin, ownedStore } from "./helpers/domain.js";
import { AssetError } from "../src/battlefield-domain.js";
import {
  createAuctionTeam,
  addTeamMember,
  validateStartReadiness,
  type StartReadinessInput,
} from "../src/domain.js";

function flag() {
  return { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" };
}

function readyInput(): StartReadinessInput {
  const t1 = createAuctionTeam("a-1", "Kuzey", 0, { flag: flag(), slogan: "Birlik" });
  const t2 = createAuctionTeam("a-1", "Guney", 1, { flag: flag(), slogan: "Guc" });
  addTeamMember(t1, "Elif", 10);
  addTeamMember(t2, "Deniz", 10);
  return {
    auction: { name: "Sonbahar Divani" },
    entries: ["c1", "c2", "c3", "c4"],
    candidates: [
      { id: "c1", name: "A1", hasImage: true },
      { id: "c2", name: "A2", hasImage: true },
      { id: "c3", name: "A3", hasImage: true },
      { id: "c4", name: "A4", hasImage: true },
    ],
    battlefield: {
      id: "b1",
      name: "Bati",
      geography: "Vadi",
      history: "Tarih",
      hasImage: true,
      archivedAt: null,
    },
    backgroundAvailable: true,
    teams: [t1, t2],
  };
}

describe("validateStartReadiness", () => {
  it("accepts complete preparation", () => {
    expect(validateStartReadiness(readyInput()).valid).toBe(true);
  });

  it("blocks odd and short lists with field errors", () => {
    const bad = readyInput();
    bad.entries = ["c1", "c2", "c3"];
    bad.candidates = bad.candidates.slice(0, 3);
    const r = validateStartReadiness(bad);
    expect(r.valid).toBe(false);
    expect(r.fieldErrors.some((e) => e.path === "entries")).toBe(true);
  });

  it("blocks unequal budgets", () => {
    const bad = readyInput();
    bad.teams[1].members[0].initialGold = 20;
    const r = validateStartReadiness(bad);
    expect(r.valid).toBe(false);
    expect(r.fieldErrors.some((e) => e.path === "teams")).toBe(true);
  });

  it("blocks missing battlefield and background", () => {
    const bad = readyInput();
    bad.battlefield = null;
    bad.backgroundAvailable = false;
    const r = validateStartReadiness(bad);
    expect(r.valid).toBe(false);
    expect(r.fieldErrors.some((e) => e.path === "battlefield")).toBe(true);
  });

  it("blocks missing candidate image", () => {
    const bad = readyInput();
    bad.candidates[0].hasImage = false;
    const r = validateStartReadiness(bad);
    expect(r.valid).toBe(false);
    expect(r.fieldErrors.some((e) => e.path === "candidates.c1.image")).toBe(true);
  });
});

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082",
  "hex",
);

async function seedReadyAuction(store: PgStore) {
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const c = await store.saveCandidate(`Aday ${i}`, PNG, "image/png", `a${i}.png`);
    ids.push(c.id);
  }
  const list = await store.saveList("Liste", false);
  for (const id of ids) await store.addEntryToList(list.id, id);
  const auction = await store.saveAuction("Divan", list.id);
  const field = await store.battlefields.create(
    { name: "Alan", geography: "Vadi", history: "Tarih" },
    { buffer: PNG, mime: "image/png", name: "b.png" },
  );
  await store.battlefields.select(auction.id, field.id);
  const flag = { buffer: PNG, mime: "image/png", name: "flag.png" };
  const t1 = createAuctionTeam(auction.id, "Kuzey", 0, { flag, slogan: "Birlik" });
  const t2 = createAuctionTeam(auction.id, "Guney", 1, { flag, slogan: "Guc" });
  addTeamMember(t1, "Elif", 10);
  addTeamMember(t2, "Deniz", 10);
  await store.teams.saveAuctionTeams(auction.id, [t1, t2]);
  return { auction, ids, list, field };
}

describe("POST /auctions/:id/start", () => {
  it("validates, starts, and locks preparation over HTTP", async () => {
    const { buildApp } = await import("../src/app.js");
    const { Server } = await import("node:http");
    const store = await ownedStore(DATABASE_URL);
    const app = buildApp(store, { allowedOrigin: fixtureOrigin });
    const server: InstanceType<typeof Server> = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const addr = server.address();
    const base =
      addr && typeof addr === "object" ? `http://127.0.0.1:${addr.port}` : "";
    try {
      const request = await fixtureClient(base, store);
      const bad = await (
        await request(`/auctions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bos", sourceListId: null }),
        })
      ).json();
      const rejected = await request(`/auctions/${bad.id}/start`, { method: "POST" });
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).fieldErrors.length).toBeGreaterThan(0);

      const { auction } = await (async () => {
        const s = (await PgStore.connect(DATABASE_URL)).forUser(store.userId);
        try {
          return await seedReadyAuction(s);
        } finally {
          await s.close();
        }
      })();
      const started = await request(`/auctions/${auction.id}/start`, { method: "POST" });
      expect(started.status).toBe(200);
      expect((await started.json()).status).toBe("ongoing");

      const locked = await request(`/auctions/${auction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Degisti" }),
      });
      expect(locked.status).toBe(409);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await store.close();
    }
  }, 30000);
});

describe("startAuction transaction", () => {
  it.each(["add", "remove", "reorder", "edit", "edit-following"] as const)("rejects %s when start commits after draft preflight but before the mutation transaction", async (action) => {
    const store = await ownedStore(DATABASE_URL);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const { auction, ids } = await seedReadyAuction(store);
      if (action !== "edit-following") await store.renameAuction(auction.id, "Forked draft");
      const extra = await store.saveCandidate("Extra", PNG, "image/png", "extra.png");
      let notify!: () => void;
      const reached = new Promise<void>(resolve => { notify = resolve; });
      let paused = false;
      const pause = async () => {
        if (paused) return;
        paused = true;
        notify();
        await gate;
      };
      // Pause only the mutation's connection/write; start runs on the real pool.
      const delayedPool = {
        query: async (text: string, params?: unknown[]) => {
          if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(text)) await pause();
          return store.pool!.query(text, params);
        },
        connect: async () => { await pause(); return store.pool!.connect(); },
      };
      const mutator = new PgStore(delayedPool).forUser(store.userId);
      const operation = action === "add" ? mutator.addEntryToAuction(auction.id, extra.id)
        : action === "remove" ? mutator.removeEntryFromAuction(auction.id, ids[0])
        : action === "reorder" ? mutator.reorderEntryInAuction(auction.id, ids[0], 1)
        : mutator.editDraftEntryCandidate(auction.id, ids[0], "Changed", null);
      const outcome = operation.then(() => null, error => error);
      await reached;
      await store.startAuction(auction.id);
      const live = await store.live.sendNext(auction.id);
      const candidates = await store.listCandidates();
      release();
      expect(await outcome).toEqual(new AssetError("preparation locked"));
      expect((await store.getAuction(auction.id)).entries).toEqual(ids);
      expect(await store.live.getLive(auction.id)).toEqual(live);
      expect(await store.listCandidates()).toEqual(candidates);
    } finally {
      release();
      await store.close();
    }
  });

  it("blocks start until preparation constraints pass", async () => {
    const store = await ownedStore(DATABASE_URL);
    try {
      const bad = await store.saveAuction("Bos", null);
      await expect(store.startAuction(bad.id)).rejects.toMatchObject({ fieldErrors: expect.any(Array) });
      expect((await store.getAuction(bad.id)).status).toBe("draft");
    } finally {
      await store.close();
    }
  }, 30000);

  it("locks preparation atomically and preserves it across library changes", async () => {
    const store = await ownedStore(DATABASE_URL);
    try {
      const { auction, ids, list } = await seedReadyAuction(store);
      const started = await store.startAuction(auction.id);
      expect(started.status).toBe("ongoing");
      expect(started.followsSource).toBe(false);
      expect(started.entries).toEqual(ids);

      // Later source-list edits do not leak into the locked auction.
      const extra = await store.saveCandidate("Yeni", PNG, "image/png", "yeni.png");
      await store.addEntryToList(list.id, extra.id);
      expect((await store.getAuction(auction.id)).entries).toEqual(ids);

      // Preparation mutations are rejected after lock.
      await expect(store.renameAuction(auction.id, "Degisti")).rejects.toEqual(
        new AssetError("preparation locked"),
      );
      await expect(store.addEntryToAuction(auction.id, extra.id)).rejects.toEqual(
        new AssetError("preparation locked"),
      );
      await expect(store.removeEntryFromAuction(auction.id, ids[0])).rejects.toEqual(
        new AssetError("preparation locked"),
      );

      // Restart restores the same locked preparation.
      const fresh = (await PgStore.connect(DATABASE_URL)).forUser(store.userId);
      try {
        const again = await fresh.getAuction(auction.id);
        expect(again.status).toBe("ongoing");
        expect(again.entries).toEqual(ids);
        expect((await fresh.teams.getAuctionTeams(auction.id)).map((t) => t.name)).toEqual([
          "Kuzey",
          "Guney",
        ]);
      } finally {
        await fresh.close();
      }
    } finally {
      await store.close();
    }
  }, 30000);
});
