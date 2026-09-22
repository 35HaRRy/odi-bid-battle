import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "node:http";
import { buildApp } from "../src/app.js";
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
        members: [{ name: "Deniz", initialGold: 10, avatar: null }],
      },
    ],
  };
}

function unequalPayload() {
  const body = payload();
  body.teams[1].members[0].initialGold = 20;
  return body;
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

  it("saves and reloads equal drafts", async () => {
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

  it("rejects unequal budgets without saving", async () => {
    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "E", sourceListId: null }),
      })
    ).json();

    const res = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(unequalPayload()),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid teams");
    expect(json.fieldErrors.some((f: { path: string }) => f.path === "teams")).toBe(true);
  });

  it("rejects empty slogan with field-level errors", async () => {
    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "F", sourceListId: null }),
      })
    ).json();

    const body = payload();
    body.teams[0].slogan = "  ";
    const res = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(
      json.fieldErrors.some((f: { path: string }) => f.path === "teams[0].slogan"),
    ).toBe(true);
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

  it("uploads images separately and saves by reference", async () => {
    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Refs", sourceListId: null }),
      })
    ).json();

    async function upload(): Promise<{ uploadId: string; mime: string; name: string; size: number; url: string }> {
      const fd = new FormData();
      fd.append("image", new File([FLAG_BYTES], "flag.png", { type: "image/png" }));
      const res = await fetch(`${base}/auctions/${auction.id}/team-images`, { method: "POST", body: fd });
      expect(res.status).toBe(201);
      return res.json();
    }

    const up1 = await upload();
    const up2 = await upload();
    expect(up1.uploadId).toBeTruthy();
    expect(up1.size).toBe(FLAG_BYTES.length);

    const staged = await fetch(`${base}${up1.url}`);
    expect(staged.status).toBe(200);
    expect(staged.headers.get("content-type")).toContain("image/png");

    const save = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teams: [
          { name: "Kuzey", slogan: "Birlik", position: 0, flag: { uploadId: up1.uploadId }, members: [{ name: "Elif", initialGold: 10, avatar: null }] },
          { name: "Guney", slogan: "Guc", position: 1, flag: { uploadId: up2.uploadId }, members: [{ name: "Deniz", initialGold: 10, avatar: null }] },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const saved = await save.json();
    // Summaries carry no base64 bytes — only metadata plus per-file URLs.
    expect(saved[0].flag.data).toBeUndefined();
    expect(saved[0].flag.url).toContain(`/teams/${saved[0].id}/flag`);
    expect(saved[0].flag.size).toBe(FLAG_BYTES.length);

    const flag = await fetch(`${base}${saved[0].flag.url}`);
    expect(flag.status).toBe(200);
    expect(Buffer.from(await flag.arrayBuffer()).equals(FLAG_BYTES)).toBe(true);

    // Unchanged images can be re-saved by reuse reference without re-upload.
    const resave = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teams: [
          { name: "Kuzey", slogan: "Birlik", position: 0, flag: { teamId: saved[0].id }, members: [{ name: "Elif", initialGold: 10, avatar: null }] },
          { name: "Guney", slogan: "Guc", position: 1, flag: { teamId: saved[1].id }, members: [{ name: "Deniz", initialGold: 10, avatar: null }] },
        ],
      }),
    });
    expect(resave.status).toBe(200);
  });

  it("saves large combined images via separate uploads without 413", async () => {
    const auction = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "BigRefs", sourceListId: null }),
      })
    ).json();

    // Each file stays under the 3.5 MB single-file ceiling, but together
    // they exceed the 4 MB JSON body budget — the old combined check 413'd
    // this even though the save request itself only carries tiny references.
    const big = Buffer.alloc(2_500_000);
    Buffer.from("89504e470d0a1a0a", "hex").copy(big, 0);
    async function uploadBig(): Promise<{ uploadId: string }> {
      const fd = new FormData();
      fd.append("image", new File([big], "flag.png", { type: "image/png" }));
      const res = await fetch(`${base}/auctions/${auction.id}/team-images`, { method: "POST", body: fd });
      expect(res.status).toBe(201);
      return res.json();
    }
    const up1 = await uploadBig();
    const up2 = await uploadBig();

    const save = await fetch(`${base}/auctions/${auction.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teams: [
          { name: "Kuzey", slogan: "Birlik", position: 0, flag: { uploadId: up1.uploadId }, members: [{ name: "Elif", initialGold: 10, avatar: null }] },
          { name: "Guney", slogan: "Guc", position: 1, flag: { uploadId: up2.uploadId }, members: [{ name: "Deniz", initialGold: 10, avatar: null }] },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const saved = await save.json();
    expect(saved[0].flag.size).toBe(big.length);
  });

  it("rejects cross-auction upload references", async () => {
    const a = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A1", sourceListId: null }),
      })
    ).json();
    const b = await (
      await fetch(`${base}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "B1", sourceListId: null }),
      })
    ).json();
    const fd = new FormData();
    fd.append("image", new File([FLAG_BYTES], "flag.png", { type: "image/png" }));
    const up = await (
      await fetch(`${base}/auctions/${a.id}/team-images`, { method: "POST", body: fd })
    ).json();
    const res = await fetch(`${base}/auctions/${b.id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teams: [
          { name: "Kuzey", slogan: "Birlik", position: 0, flag: { uploadId: up.uploadId }, members: [{ name: "Elif", initialGold: 10, avatar: null }] },
          { name: "Guney", slogan: "Guc", position: 1, flag: FLAG, members: [{ name: "Deniz", initialGold: 10, avatar: null }] },
        ],
      }),
    });
    expect(res.status).toBe(400);
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
