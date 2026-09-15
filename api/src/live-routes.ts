import type { Express, Request, Response } from "express";
import { isLiveError } from "./live-store.js";
import type { PgStore } from "./store.js";

function liveHttp(err: unknown): { status: number; body: string } {
  const msg = (err as Error).message ?? "";
  if (msg === "auction not found") return { status: 404, body: "not found" };
  if (msg === "auction teams missing") return { status: 409, body: "auction teams missing" };
  if (msg === "auction not started" || msg === "auction completed")
    return { status: 409, body: msg };
  if (isLiveError(msg)) return { status: 400, body: msg };
  return { status: 500, body: "persistence failed" };
}

export function mountLiveRoutes(app: Express, store: PgStore): void {
  const live = store.live;
  const handle =
    (operation: (id: string, req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        res.json(await operation(req.params.id, req));
      } catch (err) {
        const h = liveHttp(err);
        res.status(h.status).json({ error: h.body });
      }
    };

  app.get("/auctions/:id/live", handle((id) => live.getLive(id)));
  app.post("/auctions/:id/live/next", handle((id) => live.sendNext(id)));

  app.post("/auctions/:id/live/bids", async (req, res) => {
    try {
      const team = Number(req.body?.team);
      const contributions = req.body?.contributions;
      if (team !== 0 && team !== 1)
        return res.status(400).json({ error: "invalid team" });
      if (
        !Array.isArray(contributions) ||
        contributions.some((v: unknown) => typeof v !== "number")
      )
        return res.status(400).json({ error: "invalid contributions" });
      res.json(await live.confirmBid(req.params.id, team, contributions, req.body?.drafts));
    } catch (err) {
      const h = liveHttp(err);
      return res.status(h.status).json({ error: h.body });
    }
  });

  app.post("/auctions/:id/live/pass", handle((id, req) => live.pass(id, req.body?.drafts)));

  app.post("/auctions/:id/live/sale", handle((id, req) => live.sell(id, req.body?.drafts)));

  app.post("/auctions/:id/live/end", handle((id) => live.endAuction(id)));
  app.post("/auctions/:id/live/undo", handle((id) => live.undo(id)));
}
