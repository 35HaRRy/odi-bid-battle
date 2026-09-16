import cors from "cors";
import express from "express";
import { PgStore } from "./store.js";
import { AssetError } from "./battlefield-domain.js";
import { StartValidationError } from "./domain.js";
import {
  REQUEST_BODY_BUDGET_BYTES,
  jsonUtf8Bytes,
  PayloadTooLargeError,
} from "./limits.js";
import { isMulterFileSizeError, uploadSingle } from "./upload.js";
import { assetErrorHttp, mountBattlefieldRoutes } from "./battlefield-routes.js";
import { mountLiveRoutes } from "./live-routes.js";
import { mountTeamRoutes } from "./team-routes.js";

function toHttp(err: unknown): { status: number; body: string } {
  if (err instanceof AssetError) return assetErrorHttp(err) as { status: number; body: string };
  if (err instanceof PayloadTooLargeError) return { status: 413, body: err.message };
  if (err instanceof StartValidationError)
    return { status: 400, body: "invalid preparation" };
  const msg = (err as Error).message ?? "";
  if (msg === "preparation locked") return { status: 409, body: msg };
  if (msg === "invalid name" || msg === "invalid image")
    return { status: 400, body: msg };
  if (/duplicate/i.test(msg)) return { status: 409, body: "duplicate entry" };
  if (
    msg === "candidate not found" ||
    msg === "list not found" ||
    msg === "entry not found" ||
    msg === "auction not found"
  )
    return { status: 404, body: "not found" };
  if (msg === "only drafts can be deleted") return { status: 409, body: "only drafts can be deleted" };
  return { status: 500, body: "persistence failed" };
}

function toImageInput(
  file: Express.Multer.File | undefined,
): { buffer: Buffer; mime: string; name: string } | null {
  if (!file) return null;
  return { buffer: file.buffer, mime: file.mimetype, name: file.originalname };
}

// Importing this module must not open ports or database connections; it only
// builds the Express app. Standalone startup lives in server.ts, Vercel
// startup in web/api/index.ts.
export function buildApp(store: PgStore): express.Express {
  const app = express();
  // Local dev runs the frontend on :5173 against the API on :3001, so CORS
  // stays enabled outside production. Production serves frontend and API
  // from the same origin and needs no broad CORS allowance.
  if (process.env.NODE_ENV !== "production") {
    app.use(cors());
  }
  // Reject declared over-budget bodies before any parser streams them.
  app.use((req, res, next) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > REQUEST_BODY_BUDGET_BYTES) {
      return res.status(413).json({ error: "payload too large" });
    }
    next();
  });
  app.use(express.json({ limit: REQUEST_BODY_BUDGET_BYTES }));
  // Measure actual JSON bytes too: chunked requests carry no Content-Length.
  app.use((req, res, next) => {
    if (req.body !== undefined && typeof req.body === "object" && req.body !== null) {
      try {
        if (jsonUtf8Bytes(req.body) > REQUEST_BODY_BUDGET_BYTES) {
          return res.status(413).json({ error: "payload too large" });
        }
      } catch {
        return res.status(400).json({ error: "invalid json" });
      }
    }
    next();
  });
  mountBattlefieldRoutes(app, store);
  mountTeamRoutes(app, store);
  mountLiveRoutes(app, store);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/candidates", uploadSingle("image"), async (req, res) => {
    try {
      const name = String(req.body?.name ?? "");
      const file = req.file;
      if (!file) return res.status(400).json({ error: "image required" });
      const rec = await store.saveCandidate(
        name,
        file.buffer,
        file.mimetype,
        file.originalname,
      );
      res.status(201).json({ id: rec.id, name: rec.name });
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.get("/candidates", async (_req, res) => {
    try {
      const list = await store.listCandidates();
      res.json(list.map((c) => ({ id: c.id, name: c.name })));
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.get("/candidates/:id", async (req, res) => {
    try {
      const rec = await store.getCandidate(req.params.id);
      res.json({
        id: rec.id,
        name: rec.name,
        archived: rec.archivedAt !== null,
      });
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.get("/candidates/:id/image", async (req, res) => {
    try {
      const rec = await store.getCandidate(req.params.id);
      res.setHeader("Content-Type", rec.imageMime || "image/png");
      res.send(rec.image);
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/candidates/:id/archive", async (req, res) => {
    try {
      await store.archiveCandidate(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post(
    "/candidates/:id/edit",
    uploadSingle("image"),
    async (req, res) => {
      try {
        const name = String(req.body?.name ?? "");
        const file = req.file;
        const rec = await store.editCatalogCandidate(
          req.params.id,
          name,
          toImageInput(file),
        );
        res.json({ id: rec.id, name: rec.name });
      } catch (err) {
        const h = toHttp(err);
        return res.status(h.status).json({ error: h.body });
      }
    },
  );

  app.post("/lists", async (req, res) => {
    try {
      const { name = "", isDraft = true } = req.body ?? {};
      const rec = await store.saveList(String(name), Boolean(isDraft));
      res.status(201).json(rec);
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.get("/lists", async (_req, res) => {
    try {
      res.json(await store.listLists());
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.get("/lists/:id", async (req, res) => {
    try {
      res.json(await store.getList(req.params.id));
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/lists/:id/entries", async (req, res) => {
    try {
      await store.addEntryToList(req.params.id, String(req.body?.candidateId ?? ""));
      res.json(await store.getList(req.params.id));
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.delete("/lists/:id/entries/:candidateId", async (req, res) => {
    try {
      await store.removeEntryFromList(req.params.id, req.params.candidateId);
      res.json(await store.getList(req.params.id));
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/lists/:id/reorder", async (req, res) => {
    try {
      await store.reorderEntryInList(
        req.params.id,
        String(req.body?.candidateId ?? ""),
        Number(req.body?.toIndex ?? 0),
      );
      res.json(await store.getList(req.params.id));
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/lists/:id/archive", async (req, res) => {
    try {
      await store.archiveList(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/lists/:id/clone", async (req, res) => {
    try {
      const rec = await store.cloneList(req.params.id);
      res.status(201).json(rec);
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post(
    "/lists/:id/entries/:candidateId/edit",
    uploadSingle("image"),
    async (req, res) => {
      try {
        const name = String(req.body?.name ?? "");
        const file = req.file;
        const rec = await store.editListEntryCandidate(
          req.params.id,
          req.params.candidateId,
          name,
          toImageInput(file),
        );
        res.json({ candidate: { id: rec.id, name: rec.name }, list: await store.getList(req.params.id) });
      } catch (err) {
        const h = toHttp(err);
        return res.status(h.status).json({ error: h.body });
      }
    },
  );

  app.post("/auctions", async (req, res) => {
    try {
      const { name = "", sourceListId = null } = req.body ?? {};
      const rec = await store.saveAuction(
        String(name),
        sourceListId ? String(sourceListId) : null,
      );
      res.status(201).json(rec);
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/auctions/:id/clone", async (req, res) => {
    try {
      const name = String(req.body?.name ?? "");
      res.status(201).json(await store.cloneAuction(req.params.id, name));
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.get("/auctions", async (_req, res) => {
    try {
      res.json(await store.listAuctions());
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.get("/auctions/:id", async (req, res) => {
    try {
      res.json(await store.getAuction(req.params.id));
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.delete("/auctions/:id", async (req, res) => {
    try {
      await store.deleteDraftAuction(req.params.id);
      res.status(204).end();
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/auctions/:id/start", async (req, res) => {
    try {
      res.json(await store.startAuction(req.params.id));
    } catch (err) {
      if (err instanceof StartValidationError) {
        return res
          .status(400)
          .json({ error: "invalid preparation", fieldErrors: err.fieldErrors });
      }
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.patch("/auctions/:id", async (req, res) => {
    try {
      const battlefieldId = req.body?.battlefieldId;
      if (battlefieldId !== undefined && battlefieldId !== null && typeof battlefieldId !== "string") {
        return res.status(400).json({ error: "invalid battlefieldId" });
      }
      let rec = await store.getAuction(req.params.id);
      if (req.body?.name !== undefined)
        rec = await store.renameAuction(req.params.id, String(req.body.name));
      if (req.body?.battlefieldId !== undefined)
        rec = await store.setAuctionBattlefield(
          req.params.id,
          battlefieldId,
        );
      res.json(rec);
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/auctions/:id/entries", async (req, res) => {
    try {
      res.json(
        await store.addEntryToAuction(
          req.params.id,
          String(req.body?.candidateId ?? ""),
        ),
      );
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.delete("/auctions/:id/entries/:candidateId", async (req, res) => {
    try {
      res.json(
        await store.removeEntryFromAuction(req.params.id, req.params.candidateId),
      );
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/auctions/:id/reorder", async (req, res) => {
    try {
      res.json(
        await store.reorderEntryInAuction(
          req.params.id,
          String(req.body?.candidateId ?? ""),
          Number(req.body?.toIndex ?? 0),
        ),
      );
    } catch (err) {
      const h = toHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post(
    "/auctions/:id/entries/:candidateId/edit",
    uploadSingle("image"),
    async (req, res) => {
      try {
        const name = String(req.body?.name ?? "");
        const file = req.file;
        const rec = await store.editDraftEntryCandidate(
          req.params.id,
          req.params.candidateId,
          name,
          toImageInput(file),
        );
        res.json({
          candidate: { id: rec.id, name: rec.name },
          auction: await store.getAuction(req.params.id),
        });
      } catch (err) {
        const h = toHttp(err);
        return res.status(h.status).json({ error: h.body });
      }
    },
  );

  // Unknown API paths return JSON 404 so SPA fallback can never mask them.
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Body-parser (entity.too.large) and multer (LIMIT_FILE_SIZE) errors skip
  // route handlers, so map them to JSON 413 instead of an HTML error page.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = (err as { status?: number }).status;
    const type = (err as { type?: string }).type;
    if (status === 413 || type === "entity.too.large") {
      return res.status(413).json({ error: "payload too large" });
    }
    if (err instanceof PayloadTooLargeError) {
      return res.status(413).json({ error: err.message });
    }
    if (isMulterFileSizeError(err)) {
      return res.status(413).json({ error: "image too large" });
    }
    return next(err);
  });

  return app;
}
