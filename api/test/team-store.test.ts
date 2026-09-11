import { describe, expect, it } from "vitest";
import { PgStore } from "../src/store.js";
import { createAuctionTeam, addTeamMember } from "../src/domain.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

const flag = {
  buffer: Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082",
    "hex",
  ),
  mime: "image/png",
  name: "flag.png",
};

describe("team store persistence", () => {
  it("saves unequal drafts, reloads them, and isolates auctions", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      const auction = await store.saveAuction("Team battle", null);
      const t1 = createAuctionTeam(auction.id, "Kuzey", 0, { flag });
      const t2 = createAuctionTeam(auction.id, "Guney", 1, { flag });
      addTeamMember(t1, "Elif", 10);
      addTeamMember(t2, "Deniz", 20);

      // Unequal totals must remain saveable as a draft.
      const saved = await store.teams.saveAuctionTeams(auction.id, [t1, t2]);
      expect(saved).toHaveLength(2);
      expect(saved[0].position).toBe(0);
      expect(saved[1].position).toBe(1);

      const loaded = await store.teams.getAuctionTeams(auction.id);
      expect(loaded.map((t) => t.name)).toEqual(["Kuzey", "Guney"]);
      expect(loaded[0].members.map((m) => m.name)).toEqual(["Elif"]);
      expect(loaded[0].members[0].initialGold).toBe(10);
      expect(loaded[0].flag.buffer).toEqual(flag.buffer);

      // Full replace: removed members disappear.
      t1.members = [];
      addTeamMember(t1, "Yeni", 5);
      const replaced = await store.teams.saveAuctionTeams(auction.id, [t1, t2]);
      expect(replaced[0].members.map((m) => m.name)).toEqual(["Yeni"]);

      // Isolation between auctions.
      const other = await store.saveAuction("Diger", null);
      expect(await store.teams.getAuctionTeams(other.id)).toEqual([]);
    } finally {
      await store.close();
    }
  }, 30000);

  it("rejects unknown auctions", async () => {
    const store = await PgStore.connect(DATABASE_URL);
    try {
      await expect(store.teams.getAuctionTeams("missing")).rejects.toThrow("auction not found");
      const t1 = createAuctionTeam("missing", "T1", 0, { flag });
      const t2 = createAuctionTeam("missing", "T2", 1, { flag });
      await expect(store.teams.saveAuctionTeams("missing", [t1, t2])).rejects.toThrow(
        "auction not found",
      );
    } finally {
      await store.close();
    }
  }, 30000);
});
