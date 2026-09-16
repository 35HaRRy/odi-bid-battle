import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PgStore } from "./store.js";
import { AssetError } from "./battlefield-domain.js";
import { isMulterFileSizeError, uploadSingle } from "./upload.js";
import { PayloadTooLargeError } from "./limits.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadDefaultBackground(): { buffer: Buffer; mime: string } {
  const candidates = [
    join(__dirname, "assets/default-background.svg"),
    // Vercel bundle layouts: handler at web/api, assets traced to api/...
    join(__dirname, "../../api/assets/default-background.svg"),
    join(__dirname, "../../api/src/assets/default-background.svg"),
    join(__dirname, "../src/assets/default-background.svg"),
    join(process.cwd(), "src/assets/default-background.svg"),
    join(process.cwd(), "dist/src/assets/default-background.svg"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return { buffer: readFileSync(p), mime: "image/svg+xml" };
    }
  }
  return {
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#f2e7cf"/></svg>`
    ),
    mime: "image/svg+xml",
  };
}

export function assetErrorHttp(err: AssetError): { status: number; body: string } {
  switch (err.code) {
    case "invalid name":
    case "invalid geography":
    case "invalid history":
    case "image required":
    case "image too large":
    case "invalid image":
      return { status: 400, body: err.code };
    case "battlefield not found":
    case "auction not found":
      return { status: 404, body: err.code };
    case "battlefield archived":
    case "preparation locked":
      return { status: 409, body: err.code };
    default:
      return { status: 500, body: "persistence failed" };
  }
}

function handleMulterError(err: unknown, res: express.Response): boolean {
  if (isMulterFileSizeError(err)) {
    res.status(413).json({ error: "image too large" });
    return true;
  }
  if (err instanceof PayloadTooLargeError) {
    res.status(413).json({ error: "payload too large" });
    return true;
  }
  return false;
}

export function mountBattlefieldRoutes(app: express.Express, store: PgStore): void {
  // POST /battlefields
  app.post("/battlefields", (req, res) => {
    uploadSingle("image")(req, res, async (err) => {
      if (err) {
        if (handleMulterError(err, res)) return;
        return res.status(400).json({ error: "upload failed" });
      }
      try {
        const { name = "", geography = "", history = "" } = req.body ?? {};
        const file = req.file;
        if (!file) return res.status(400).json({ error: "image required" });
        const rec = await store.battlefields.create(
          { name: String(name), geography: String(geography), history: String(history) },
          { buffer: file.buffer, mime: file.mimetype, name: file.originalname }
        );
        const summary = {
          id: rec.id,
          name: rec.name,
          geography: rec.geography,
          history: rec.history,
          archivedAt: rec.archivedAt,
        };
        res.status(201).json(summary);
      } catch (e) {
        if (e instanceof AssetError) {
          const h = assetErrorHttp(e);
          return res.status(h.status).json({ error: h.body });
        }
        const msg = (e as Error).message ?? "";
        if (/duplicate/i.test(msg)) return res.status(409).json({ error: "duplicate entry" });
        res.status(500).json({ error: "persistence failed" });
      }
    });
  });

  // GET /battlefields
  app.get("/battlefields", async (_req, res) => {
    try {
      const list = await store.battlefields.list();
      res.json(list);
    } catch (e) {
      res.status(500).json({ error: "persistence failed" });
    }
  });

  // GET /battlefields/:id
  app.get("/battlefields/:id", async (req, res) => {
    try {
      const rec = await store.battlefields.get(req.params.id);
      const summary = {
        id: rec.id,
        name: rec.name,
        geography: rec.geography,
        history: rec.history,
        archivedAt: rec.archivedAt,
      };
      res.json(summary);
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "battlefield not found" });
    }
  });

  // GET /battlefields/:id/image
  app.get("/battlefields/:id/image", async (req, res) => {
    try {
      const rec = await store.battlefields.get(req.params.id);
      res.setHeader("Content-Type", rec.image.mime || "image/png");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.send(rec.image.buffer);
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "battlefield not found" });
    }
  });

  // POST /battlefields/:id/edit
  app.post("/battlefields/:id/edit", (req, res) => {
    uploadSingle("image")(req, res, async (err) => {
      if (err) {
        if (handleMulterError(err, res)) return;
        return res.status(400).json({ error: "upload failed" });
      }
      try {
        const { name = "", geography = "", history = "" } = req.body ?? {};
        const file = req.file;
        const imageInput = file
          ? { buffer: file.buffer, mime: file.mimetype, name: file.originalname }
          : null;
        const rec = await store.battlefields.edit(
          req.params.id,
          { name: String(name), geography: String(geography), history: String(history) },
          imageInput
        );
        res.setHeader("Cache-Control", "no-store");
        res.json({
          id: rec.id,
          name: rec.name,
          geography: rec.geography,
          history: rec.history,
          archivedAt: rec.archivedAt,
        });
      } catch (e) {
        if (e instanceof AssetError) {
          const h = assetErrorHttp(e);
          return res.status(h.status).json({ error: h.body });
        }
        res.status(500).json({ error: "persistence failed" });
      }
    });
  });

  // POST /battlefields/:id/archive
  app.post("/battlefields/:id/archive", async (req, res) => {
    try {
      await store.battlefields.archive(req.params.id);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "battlefield not found" });
    }
  });

  // GET /auctions/:id/battlefield (merged shared record + draft overrides)
  app.get("/auctions/:id/battlefield", async (req, res) => {
    try {
      const draft = await store.battlefields.getDraftBattlefield(req.params.id);
      if (!draft) return res.status(404).json({ error: "battlefield not found" });
      res.setHeader("Cache-Control", "no-store");
      res.json(draft);
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "auction not found" });
    }
  });

  // POST /auctions/:id/battlefield (draft-scoped geography/history/image)
  app.post("/auctions/:id/battlefield", (req, res) => {
    uploadSingle("image")(req, res, async (err) => {
      if (err) {
        if (handleMulterError(err, res)) return;
        return res.status(400).json({ error: "upload failed" });
      }
      try {
        const { geography, history } = req.body ?? {};
        if (geography === undefined && history === undefined && !req.file) {
          return res.status(400).json({ error: "invalid geography" });
        }
        const current = await store.battlefields.getDraftBattlefield(req.params.id);
        if (!current) return res.status(404).json({ error: "battlefield not found" });
        const next = {
          geography: geography !== undefined ? String(geography) : current.geography,
          history: history !== undefined ? String(history) : current.history,
        };
        const imageInput = req.file
          ? { buffer: req.file.buffer, mime: req.file.mimetype, name: req.file.originalname }
          : undefined;
        const updated = await store.battlefields.saveDraftBattlefield(req.params.id, next, imageInput);
        res.setHeader("Cache-Control", "no-store");
        res.json(updated);
      } catch (e) {
        if (e instanceof AssetError) {
          const h = assetErrorHttp(e);
          return res.status(h.status).json({ error: h.body });
        }
        res.status(404).json({ error: "auction not found" });
      }
    });
  });

  // GET /auctions/:id/battlefield/image (custom override or shared record)
  app.get("/auctions/:id/battlefield/image", async (req, res) => {
    try {
      const image = await store.battlefields.getDraftBattlefieldImage(req.params.id);
      res.setHeader("Content-Type", image.mime || "image/png");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.send(image.buffer);
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "battlefield not found" });
    }
  });

  // POST /auctions/:id/background
  app.post("/auctions/:id/background", (req, res) => {
    uploadSingle("image")(req, res, async (err) => {
      if (err) {
        if (handleMulterError(err, res)) return;
        return res.status(400).json({ error: "upload failed" });
      }
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "image required" });
        await store.battlefields.setBackground(req.params.id, {
          buffer: file.buffer,
          mime: file.mimetype,
          name: file.originalname,
        });
        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true });
      } catch (e) {
        if (e instanceof AssetError) {
          const h = assetErrorHttp(e);
          return res.status(h.status).json({ error: h.body });
        }
        res.status(404).json({ error: "auction not found" });
      }
    });
  });

  // DELETE /auctions/:id/background
  app.delete("/auctions/:id/background", async (req, res) => {
    try {
      await store.battlefields.setBackground(req.params.id, null);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "auction not found" });
    }
  });

  // GET /auctions/:id/background
  app.get("/auctions/:id/background", async (req, res) => {
    try {
      const bg = await store.battlefields.getBackground(req.params.id);
      if (bg) {
        res.setHeader("Content-Type", bg.mime);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        return res.send(bg.buffer);
      }
      const def = loadDefaultBackground();
      res.setHeader("Content-Type", def.mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.send(def.buffer);
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "auction not found" });
    }
  });
}
