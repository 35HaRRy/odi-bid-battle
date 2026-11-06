import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgStore } from "../../api/src/store.js";

const { attach } = vi.hoisted(() => ({ attach: vi.fn() }));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: attach }));

let server: Server | undefined;
let base: string;

beforeEach(() => {
  vi.resetModules();
  attach.mockReset();
  vi.stubEnv("DATABASE_URL", "postgres://unused/test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function start() {
  const { PgStore: Store } = await import("../../api/src/store.js");
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => { throw new Error("unexpected transaction"); },
  };
  const store = new PgStore(pool);
  const connect = vi.spyOn(Store, "connect").mockResolvedValue(store);
  const { default: handler } = await import("../api/index.js");
  expect(connect).not.toHaveBeenCalled();
  server = createServer((req, res) => {
    // Vercel adds these helpers to Node responses.
    const response = Object.assign(res, {
      status(code: number) { res.statusCode = code; return response; },
      json(body: unknown) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
        return response;
      },
    });
    void handler(req, response);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  base = `http://127.0.0.1:${address.port}`;
  return { connect, store };
}

describe("Vercel entrypoint", () => {
  it("shares initialization, serves health and protects domain routes", async () => {
    const { connect } = await start();
    const responses = await Promise.all([
      fetch(`${base}/api/health?check=1`), fetch(`${base}/api/candidates`),
    ]);
    expect(await responses[0].json()).toEqual({ ok: true });
    expect(responses[1].status).toBe(401);
    expect(await responses[1].json()).toEqual({ error: "authentication required" });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("checks CSRF and authentication before unknown API paths for all supported methods", async () => {
    await start();
    const origin = "http://localhost:5173";
    const bootstrap = await fetch(`${base}/api/auth/session`, { headers: { Origin: origin } });
    const { csrfToken } = await bootstrap.json();
    const cookie = bootstrap.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      if (method !== "GET") {
        expect((await fetch(`${base}/api/missing?x=1`, { method })).status).toBe(403);
      }
      const response = await fetch(`${base}/api/missing?x=1`, { method, headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": csrfToken } });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "authentication required" });
    }
  });

  it("retries failed database initialization", async () => {
    const { connect } = await start();
    connect.mockRejectedValueOnce(new Error("unavailable"));
    expect((await fetch(`${base}/api/health`)).status).toBe(500);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it("closes a pool and retries when lifecycle attachment fails", async () => {
    const { store } = await start();
    const close = vi.spyOn(store, "close").mockResolvedValue();
    attach.mockImplementationOnce(() => { throw new Error("attachment failed"); });
    expect((await fetch(`${base}/api/health`)).status).toBe(500);
    expect(close).toHaveBeenCalledOnce();
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it("does not fall back to localhost without DATABASE_URL", async () => {
    const { connect } = await start();
    vi.stubEnv("DATABASE_URL", "");
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "service unavailable" });
    expect(connect).not.toHaveBeenCalled();
  });
});
