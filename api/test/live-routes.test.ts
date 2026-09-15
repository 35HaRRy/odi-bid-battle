import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { buildApp } from "../src/server.js";
import { PgStore } from "../src/store.js";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082",
  "hex",
);

describe.sequential("live bidding routes", () => {
  let store: PgStore;
  let server: Server;
  let base: string;
  let auctionId: string;
  let firstCandidate: string;

  beforeEach(async () => {
    store = await PgStore.connect(DATABASE_URL);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await store.saveCandidate(`Aday ${i}`, PNG, "image/png", `a${i}.png`);
      ids.push(c.id);
    }
    firstCandidate = ids[0];
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
    await store.startAuction(auction.id);
    auctionId = auction.id;

    const app = buildApp(store);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const addr = server.address();
    if (addr && typeof addr === "object") base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await store.close();
  });

  it("runs send/next/bid over HTTP and rejects invalid bids with 400", async () => {
    const before = await (await fetch(`${base}/auctions/${auctionId}/live`)).json();
    expect(before.active).toBe(false);
    expect(before.activeCandidateId).toBeNull();

    const opened = await (
      await fetch(`${base}/auctions/${auctionId}/live/next`, { method: "POST" })
    ).json();
    expect(opened.activeCandidateId).toBe(firstCandidate);
    expect(opened.turn).toBe(0);

    const bad = await fetch(`${base}/auctions/${auctionId}/live/bids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team: 1, contributions: [5] }),
    });
    expect(bad.status).toBe(400);

    const bid = await (
      await fetch(`${base}/auctions/${auctionId}/live/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team: 0, contributions: [5] }),
      })
    ).json();
    expect(bid.latest).toMatchObject({ team: 0, amount: 5 });
    expect(bid.teams[0].remainingGold).toBe(10);
  });

  it("settles sales over HTTP and rejects sales without a confirmed bid", async () => {
    const noBid = await fetch(`${base}/auctions/${auctionId}/live/sale`, { method: "POST" });
    expect(noBid.status).toBe(400);

    await fetch(`${base}/auctions/${auctionId}/live/next`, { method: "POST" });
    const stillNoBid = await fetch(`${base}/auctions/${auctionId}/live/sale`, { method: "POST" });
    expect(stillNoBid.status).toBe(400);

    await fetch(`${base}/auctions/${auctionId}/live/bids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team: 0, contributions: [5] }),
    });
    const sold = await (
      await fetch(`${base}/auctions/${auctionId}/live/sale`, { method: "POST" })
    ).json();
    expect(sold.active).toBe(false);
    expect(sold.cursor).toBe(1);
    expect(sold.teams[0].members[0].balance).toBe(5);
    expect(sold.teams[0].acquired[0].price).toBe(5);
    expect(sold.teams[0].acquired[0].candidateId).toBe(firstCandidate);

    const duplicate = await fetch(`${base}/auctions/${auctionId}/live/sale`, { method: "POST" });
    expect(duplicate.status).toBe(400);
  });

  it("maps draft auctions to 409 and missing auctions to 404", async () => {
    const draft = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Taslak", sourceListId: null }),
      })
    ).json();
    expect((await fetch(`${base}/auctions/${draft.id}/live`)).status).toBe(409);
    expect(
      (await fetch(`${base}/auctions/${draft.id}/live/next`, { method: "POST" })).status,
    ).toBe(409);
    expect((await fetch(`${base}/auctions/missing/live`)).status).toBe(404);
  });
});
