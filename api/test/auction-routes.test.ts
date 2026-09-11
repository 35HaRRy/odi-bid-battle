import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "node:http";
import { buildApp } from "../src/server.js";
import { PgStore } from "../src/store.js";

describe.sequential("DELETE /auctions/:id", () => {
  let store: PgStore; let server: Server; let base: string;
  beforeEach(async () => {
    store = await PgStore.connect(process.env.DATABASE_URL ?? "postgres://bidbattle:bidbattle@localhost:5433/bidbattle");
    const app = buildApp(store);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const addr = server.address();
    if (addr && typeof addr === "object") base = `http://127.0.0.1:${addr.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await store.pool?.end();
  });
  it("deletes draft, 409 on non-draft, 404 on missing", async () => {
    const draft = await (await fetch(`${base}/auctions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "D", sourceListId: null }) })).json();
    const del = await fetch(`${base}/auctions/${draft.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await fetch(`${base}/auctions/${draft.id}`)).status).toBe(404);
    const live = await (await fetch(`${base}/auctions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "L", sourceListId: null }) })).json();
    await store.pool!.query("UPDATE auctions SET status='ongoing' WHERE id=$1", [live.id]);
    const blocked = await fetch(`${base}/auctions/${live.id}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("only drafts can be deleted");
    expect((await fetch(`${base}/auctions/missing`, { method: "DELETE" })).status).toBe(404);
  });
});
