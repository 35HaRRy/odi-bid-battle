import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../../api/src/app.js";
import { PgStore } from "../../api/src/store.js";

type VercelRequest = IncomingMessage & { url?: string };
type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => VercelResponse;
};

// The Express app typed structurally so the web workspace never depends on
// express directly; all backend packages stay in the api workspace.
type ExpressApp = (req: IncomingMessage, res: ServerResponse) => void;

let appPromise: Promise<ExpressApp> | null = null;

function requiredDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  // Production never falls back to localhost: a missing DATABASE_URL must
  // fail loudly instead of pointing the live site at a developer machine.
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  return url;
}

async function getApp(): Promise<ExpressApp> {
  if (!appPromise) {
    appPromise = (async () => {
      const store = await PgStore.connect(requiredDatabaseUrl());
      // PgStore.connect uses a small pool with short idle timeouts; keep the
      // function instance alive just long enough to clean idle connections
      // up before suspension instead of leaking them.
      try {
        const { attachDatabasePool } = await import("@vercel/functions");
        const pool = (store as unknown as { pool?: unknown }).pool;
        if (pool) attachDatabasePool(pool as never);
      } catch {
        // @vercel/functions is optional outside Vercel; the pool still works.
      }
      return buildApp(store);
    })();
    // A failed cold start must be retryable on the next request, not cached.
    appPromise.catch(() => {
      appPromise = null;
    });
  }
  return appPromise;
}

// Vercel rewrites /api/:path* to this function without stripping the prefix,
// so remove it here: outer /api/candidates reaches the inner /candidates.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const app = await getApp();
    const url = req.url ?? "/";
    const stripped = url.replace(/^\/api(?=\/|$)/, "") || "/";
    req.url = stripped;
    app(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("api init failed", err);
    res.status(500).json({ error: "service unavailable" });
  }
}
