import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "node:http";
import { buildApp } from "../src/app.js";
import { PgStore } from "../src/store.js";
import { fixtureFetch, fixtureOrigin, ownedStore } from "./helpers/domain.js";
import {
  REQUEST_BODY_BUDGET_BYTES,
  SINGLE_FILE_LIMIT_BYTES,
  estimateSerializedTeamsBytes,
} from "../src/limits.js";
import { validateAssetImage } from "../src/battlefield-domain.js";
import type { AuctionTeam } from "../src/domain.js";

const PNG_MAGIC = Buffer.from("89504e470d0a1a0a", "hex");

function pngBuffer(size: number): Buffer<ArrayBuffer> {
  const buf = Buffer.alloc(size);
  PNG_MAGIC.copy(buf, 0);
  return buf;
}

function teamWithFlag(flagBytes: number): AuctionTeam[] {
  const flag = { buffer: pngBuffer(flagBytes), mime: "image/png", name: "flag.png" };
  const member = {
    id: "",
    teamId: "",
    name: "Elif",
    avatar: { buffer: null, mime: null, name: null },
    initialGold: 10,
    createdAt: new Date(0).toISOString(),
  };
  return [0, 1].map((position) => ({
    id: "",
    auctionId: "",
    name: position === 0 ? "Kuzey" : "Guney",
    slogan: "Birlik",
    flag,
    position: position as 0 | 1,
    members: [{ ...member }],
    createdAt: new Date(0).toISOString(),
  }));
}

describe("deployment budgets", () => {
  it("keeps the app budget below the platform ceiling with room for framing", () => {
    expect(REQUEST_BODY_BUDGET_BYTES).toBe(4_000_000);
    expect(SINGLE_FILE_LIMIT_BYTES).toBe(3_500_000);
    expect(SINGLE_FILE_LIMIT_BYTES).toBeLessThan(REQUEST_BODY_BUDGET_BYTES);
  });

  it("rejects uploads over the single-file ceiling", () => {
    expect(() =>
      validateAssetImage({ buffer: pngBuffer(SINGLE_FILE_LIMIT_BYTES + 1), mime: "image/png", name: "big.png" }),
    ).toThrow("image too large");
    expect(() =>
      validateAssetImage({ buffer: pngBuffer(SINGLE_FILE_LIMIT_BYTES), mime: "image/png", name: "edge.png" }),
    ).not.toThrow();
  });

  it("estimates serialized team payloads over budget before persisting", () => {
    expect(estimateSerializedTeamsBytes(teamWithFlag(1024))).toBeLessThan(REQUEST_BODY_BUDGET_BYTES);
    expect(estimateSerializedTeamsBytes(teamWithFlag(3_400_000))).toBeGreaterThan(REQUEST_BODY_BUDGET_BYTES);
  });
});

describe("budget enforcement over authenticated HTTP", () => {
  let store: PgStore;
  let fetch: Awaited<ReturnType<typeof fixtureFetch>>;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    store = await ownedStore(process.env.DATABASE_URL!);
    const app = buildApp(store, { allowedOrigin: fixtureOrigin });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address();
    base = addr && typeof addr === "object" ? `http://127.0.0.1:${addr.port}` : "";
    fetch = await fixtureFetch(base, store);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.close();
  });

  it("answers health and unknown paths as JSON", async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    const missing = await fetch(`${base}/no-such-path`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not found" });
  });

  it("rejects declared over-budget JSON with JSON 413", async () => {
    const res = await fetch(`${base}/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(REQUEST_BODY_BUDGET_BYTES), isDraft: true }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload too large" });
  });

  it("rejects over-budget team payloads before domain persistence", async () => {
    const teams = teamWithFlag(3_400_000).map((team, i) => ({
      name: team.name,
      slogan: team.slogan,
      position: i,
      flag: { data: team.flag.buffer.toString("base64"), mime: team.flag.mime, name: team.flag.name },
      members: [{ name: "Elif", initialGold: 10, avatar: null }],
    }));
    const res = await fetch(`${base}/auctions/any-id/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teams }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload too large" });
  });

  it("rejects single files over the ceiling with JSON 413", async () => {
    const fd = new FormData();
    fd.append("name", "Aday");
    fd.append("image", new Blob([pngBuffer(SINGLE_FILE_LIMIT_BYTES + 100_000)]), "big.png");
    const res = await fetch(`${base}/candidates`, { method: "POST", body: fd });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "image too large" });
  });
});
