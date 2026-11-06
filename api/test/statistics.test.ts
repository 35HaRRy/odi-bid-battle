import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { addTeamMember, createAuctionTeam } from "../src/domain.js";
import { ownedStore, fixtureClient, fixtureOrigin } from "./helpers/domain.js";
import type { PgStore } from "../src/store.js";

const url = process.env.DATABASE_URL ?? "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";
const image = { buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082", "hex"), mime: "image/png", name: "test.png" };

async function seed(store: PgStore) {
  const list = await store.saveList("Report list", false);
  for (let i = 0; i < 4; i++) {
    const c = await store.saveCandidate(`Candidate ${i}`, image.buffer, image.mime, image.name);
    await store.addEntryToList(list.id, c.id);
  }
  const auction = await store.saveAuction("Report auction", list.id);
  const field = await store.battlefields.create({ name: "Field", geography: "Valley", history: "History" }, image);
  await store.battlefields.select(auction.id, field.id);
  const north = createAuctionTeam(auction.id, "North", 0, { flag: image });
  const south = createAuctionTeam(auction.id, "South", 1, { flag: image });
  addTeamMember(north, "Elif", 10);
  addTeamMember(north, "Kaya", 10);
  addTeamMember(south, "Deniz", 20);
  await store.teams.saveAuctionTeams(auction.id, [north, south]);
  await store.pool!.query(`UPDATE auction_team_members SET created_at=CASE name
    WHEN 'Elif' THEN '2026-01-01'::timestamptz ELSE '2026-01-02'::timestamptz END
    WHERE team_id IN (SELECT id FROM auction_teams WHERE auction_id=$1)`, [auction.id]);
  await store.startAuction(auction.id);
  return auction;
}

describe("private statistics", () => {
  it("counts only owned active records and protects report routes from other users and guests", async () => {
    const a = await ownedStore(url);
    const b = await ownedStore(url);
    const server = createServer(buildApp(a, { allowedOrigin: fixtureOrigin }));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const auction = await seed(a);
      await b.saveCandidate("Foreign public", image.buffer, image.mime, image.name, true);
      await b.saveList("Foreign public list", false, true);
      const archived = await a.saveCandidate("Archived", image.buffer, image.mime, image.name);
      await a.archiveCandidate(archived.id);
      const request = await fixtureClient(base, a);
      const overview = await request("/statistics");
      expect(overview.status).toBe(200);
      expect(overview.headers.get("cache-control")).toBe("no-store");
      expect(await overview.json()).toMatchObject({ candidates: 4, lists: 1, battlefields: 1, auctions: [{ id: auction.id, status: "ongoing", soldCount: 0, spentGold: 0 }] });
      expect((await request(`/statistics/auctions/${auction.id}`)).status).toBe(200);
      const foreign = await fixtureClient(base, b);
      expect((await foreign(`/statistics/auctions/${auction.id}`)).status).toBe(404);
      expect(await (await foreign("/statistics")).json()).toMatchObject({ candidates: 1, lists: 1, battlefields: 0, auctions: [] });
      expect((await fetch(`${base}/statistics`)).status).toBe(401);
      expect((await fetch(`${base}/statistics/auctions/${auction.id}`)).status).toBe(401);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await a.close(); await b.close();
    }
  }, 30000);

  it("reports exact winning contributions and last confirmed losing bid, ignoring edited drafts, and follows undo", async () => {
    const store = await ownedStore(url);
    try {
      const auction = await seed(store);
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 0, [1, 2]);
      await store.live.confirmBid(auction.id, 1, [5]);
      await store.live.confirmBid(auction.id, 0, [6, 0]);
      await store.live.sell(auction.id, [[6, 0], [19]]);
      const report = await store.getAuctionStatistics(auction.id);
      expect(report.sales).toHaveLength(1);
      expect(report.sales[0]).toMatchObject({ name: "Candidate 0", price: 6, winner: 0, winningContributions: [{ name: "Elif", amount: 6 }, { name: "Kaya", amount: 0 }], losingContributions: [{ name: "Deniz", amount: 5 }] });
      expect(report.teams).toMatchObject([{ name: "North", spentGold: 6, remainingGold: 14, acquiredCount: 1, members: [{ name: "Elif", spentGold: 6, remainingGold: 4 }, { name: "Kaya", spentGold: 0, remainingGold: 10 }] }, { name: "South", spentGold: 0, remainingGold: 20, acquiredCount: 0 }]);
      expect((await store.getStatistics()).auctions[0]).toMatchObject({ soldCount: 1, spentGold: 6 });
      await store.live.undo(auction.id);
      expect((await store.getAuctionStatistics(auction.id)).sales).toEqual([]);
      expect((await store.getStatistics()).auctions[0]).toMatchObject({ soldCount: 0, spentGold: 0 });
    } finally { await store.close(); }
  }, 30000);

  it("distinguishes no losing bid from missing historical detail", async () => {
    const store = await ownedStore(url);
    try {
      const auction = await seed(store);
      await store.live.sendNext(auction.id);
      await store.live.confirmBid(auction.id, 0, [2, 3]);
      await store.live.sell(auction.id, [[2, 3], [15]]);
      expect((await store.getAuctionStatistics(auction.id)).sales[0]).toMatchObject({ losingContributions: [], winningContributions: [{ name: "Elif", amount: 2 }, { name: "Kaya", amount: 3 }] });
      await store.pool!.query("DELETE FROM auction_live_history WHERE auction_id=$1", [auction.id]);
      expect((await store.getAuctionStatistics(auction.id)).sales[0]).toMatchObject({ price: 5, winningContributions: null, losingContributions: null });
    } finally { await store.close(); }
  }, 30000);
});
