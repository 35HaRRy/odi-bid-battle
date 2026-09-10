import cors from "cors";
import express from "express";
import multer from "multer";
import { PgStore } from "./store.js";

const PORT = Number(process.env.PORT ?? 3001);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

function toHttp(err: unknown): { status: number; body: string } {
  const msg = (err as Error).message ?? "";
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
  return { status: 500, body: "persistence failed" };
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function toImageInput(
  file: Express.Multer.File | undefined,
): { buffer: Buffer; mime: string; name: string } | null {
  if (!file) return null;
  return { buffer: file.buffer, mime: file.mimetype, name: file.originalname };
}

export function buildApp(store: PgStore): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/candidates", upload.single("image"), async (req, res) => {
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
    upload.single("image"),
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

  app.post(
    "/lists/:id/entries/:candidateId/edit",
    upload.single("image"),
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

  app.patch("/auctions/:id", async (req, res) => {
    try {
      let rec = await store.getAuction(req.params.id);
      if (req.body?.name !== undefined)
        rec = await store.renameAuction(req.params.id, String(req.body.name));
      if (req.body?.battlefieldId !== undefined)
        rec = await store.setAuctionBattlefield(
          req.params.id,
          req.body.battlefieldId ? String(req.body.battlefieldId) : null,
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
    upload.single("image"),
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

  return app;
}

if (process.env.VITEST !== "true") {
  const store = await PgStore.connect(DATABASE_URL);
  const app = buildApp(store);
  app.listen(PORT, () => console.log(`api on :${PORT}`));
}
