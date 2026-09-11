import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "node:http";
import { buildApp } from "../src/server.js";
import { PgStore } from "../src/store.js";

// Minimal valid PNG so the shared magic-byte upload policy accepts it.
const FLAG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082",
  "hex",
);
const FLAG = {
  data: FLAG_BYTES.toString("base64"),
  mime: "image/png",
  name: "flag.png",
};

function payload() {
  return {
    teams: [
      {
        name: "Kuzey",
        slogan: "Birlik",
        position: 0,
        flag: FLAG,
        members: [{ name: "Elif", initialGold: 10, avatar: null }],
      },
      {
        name: "Guney",
        slogan: "Guc",
        position: 1,
        flag: FLAG,
        members: [{ name: "Deniz", initialGold: 20, avatar: null }],
      },
    ],
  };
}

describe.sequential("Auction team HTTP routes", () => {
  let store: PgStore;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    store = await PgStore.connect(
      process.env.DATABASE_URL ?? "postgres://bidbattle:bidbattle@localhost:5433/bidbattle",
    );
    const app = buildApp(store);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address();
    if (addr && typeof addr === "object") {
      base = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.pool?.end();
  });

  it("saves and reloads unequal drafts", async () => {
    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A", sourceListId: null }),
      })
    ).json();

    const save = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    expect(save.status).toBe(200);
    const saved = await save.json();
    expect(saved).toHaveLength(2);
    expect(saved[0].members[0].initialGold).toBe(10);

    const load = await fetch(`${base}/auctions/${auction.id}/teams`);
    expect(load.status).toBe(200);
    expect((await load.json()).map((t: { name: string }) => t.name)).toEqual([
      "Kuzey",
      "Guney",
    ]);
  });

  it("rejects zero gold with field-level errors", async () => {
    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "B", sourceListId: null }),
      })
    ).json();

    const body = payload();
    body.teams[0].members[0].initialGold = 0;
    const res = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid teams");
    expect(json.fieldErrors.some((f: { path: string }) => f.path === "teams[0].members[0].initialGold")).toBe(
      true,
    );
  });

  it("rejects corrupt flag bytes with field-level errors", async () => {
    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "D", sourceListId: null }),
      })
    ).json();

    const body = payload();
    body.teams[1].flag = { data: "!!!not-base64!!!", mime: "image/png", name: "flag.png" };
    const res = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(
      json.fieldErrors.some((f: { path: string }) => f.path === "teams[1].flag"),
    ).toBe(true);
  });

  it("requires exactly two teams and known auctions", async () => {
    const one = await fetch(`${base}/auctions/missing/teams`);
    expect(one.status).toBe(404);

    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "C", sourceListId: null }),
      })
    ).json();
    const res = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teams: [] }),
    });
    expect(res.status).toBe(400);
  });
});
