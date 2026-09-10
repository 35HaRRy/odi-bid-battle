import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "node:http";
import { buildApp } from "../src/server.js";
import { PgStore } from "../src/store.js";

const VALID_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000179a489740000000049454e44ae426082",
  "hex"
);

describe.sequential("Battlefield & Background HTTP Routes", () => {
  let store: PgStore;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    store = await PgStore.connect(
      process.env.DATABASE_URL ?? "postgres://bidbattle:bidbattle@localhost:5433/bidbattle"
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

  it("creates battlefield with valid image and retrieves bytes", async () => {
    const form = new FormData();
    form.set("name", "Pelennor Fields");
    form.set("geography", "Grassy plain");
    form.set("history", "Great siege");
    form.set("image", new Blob([VALID_PNG], { type: "image/png" }), "pelennor.png");

    const res = await fetch(`${base}/battlefields`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id).toBeTypeOf("string");
    expect(created.name).toBe("Pelennor Fields");

    const imgRes = await fetch(`${base}/battlefields/${created.id}/image`);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("content-type")).toBe("image/png");
    expect(imgRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(imgRes.headers.get("cache-control")).toContain("no-store");

    const buf = Buffer.from(await imgRes.arrayBuffer());
    expect(buf).toEqual(VALID_PNG);
  });

  it("rejects missing fields and unsupported images with 400", async () => {
    const form = new FormData();
    form.set("name", "");
    form.set("geography", "Plain");
    form.set("history", "History");
    form.set("image", new Blob([VALID_PNG], { type: "image/png" }), "f.png");

    const res = await fetch(`${base}/battlefields`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    const errJson = await res.json();
    expect(errJson.error).toBe("invalid name");
  });

  it("rejects oversized images with 413", async () => {
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 100);
    VALID_PNG.copy(largeBuffer);
    const form = new FormData();
    form.set("name", "Big Field");
    form.set("geography", "Geo");
    form.set("history", "Hist");
    form.set("image", new Blob([largeBuffer], { type: "image/png" }), "big.png");

    const res = await fetch(`${base}/battlefields`, { method: "POST", body: form });
    expect(res.status).toBe(413);
    const errJson = await res.json();
    expect(errJson.error).toBe("image too large");
  });

  it("manages auction background override and fallback default SVG", async () => {
    const auction = await store.saveAuction("Test Auction", null);

    // Default background before override
    const bgRes = await fetch(`${base}/auctions/${auction.id}/background`);
    expect(bgRes.status).toBe(200);
    expect(bgRes.headers.get("content-type")).toContain("svg");
    const svgText = await bgRes.text();
    expect(svgText).toContain("<svg");

    // Save background override
    const form = new FormData();
    form.set("image", new Blob([VALID_PNG], { type: "image/png" }), "bg.png");
    const postRes = await fetch(`${base}/auctions/${auction.id}/background`, {
      method: "POST",
      body: form,
    });
    expect(postRes.status).toBe(200);

    // Fetch override
    const overrideRes = await fetch(`${base}/auctions/${auction.id}/background`);
    expect(overrideRes.status).toBe(200);
    expect(overrideRes.headers.get("content-type")).toBe("image/png");
    const fetchedBuf = Buffer.from(await overrideRes.arrayBuffer());
    expect(fetchedBuf).toEqual(VALID_PNG);

    // Delete background override
    const delRes = await fetch(`${base}/auctions/${auction.id}/background`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);

    // Revert to default
    const revertRes = await fetch(`${base}/auctions/${auction.id}/background`);
    expect(revertRes.status).toBe(200);
    expect(revertRes.headers.get("content-type")).toContain("svg");
  });

  it("returns 404 for non-existent battlefield or auction", async () => {
    const res = await fetch(`${base}/battlefields/nonexistent-id/image`);
    expect(res.status).toBe(404);

    const bgRes = await fetch(`${base}/auctions/nonexistent-id/background`);
    expect(bgRes.status).toBe(404);
  });
});
