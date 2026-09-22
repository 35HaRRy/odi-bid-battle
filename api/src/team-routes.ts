import express from "express";
import { PgStore } from "./store.js";
import { AssetError, validateAssetImage } from "./battlefield-domain.js";
import { assetErrorHttp } from "./battlefield-routes.js";
import type { AuctionTeam } from "./domain.js";
import {
  REQUEST_BODY_BUDGET_BYTES,
  jsonUtf8Bytes,
  PayloadTooLargeError,
} from "./limits.js";
import { isMulterFileSizeError, uploadSingle } from "./upload.js";

export interface FieldError {
  path: string;
  message: string;
}

interface ImagePayload {
  data: unknown;
  mime: unknown;
  name: unknown;
  uploadId: unknown;
  teamId: unknown;
  memberId: unknown;
}

// Buffer.from(text, "base64") never throws, so reject non-base64 input first.
function strictBase64(text: string): Buffer | null {
  const compact = text.replace(/\s+/g, "");
  if (compact.length === 0 || compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  const buffer = Buffer.from(compact, "base64");
  if (buffer.length === 0) return null;
  return buffer;
}

function checkedImage(
  image: { buffer: Buffer; mime: string; name: string },
  path: string,
  errors: FieldError[],
): { buffer: Buffer; mime: string; name: string } | null {
  try {
    validateAssetImage(image);
  } catch (e) {
    errors.push({ path, message: (e as AssetError).code ?? "invalid image" });
    return null;
  }
  if (!image.name.trim()) {
    errors.push({ path, message: "image name required" });
    return null;
  }
  return image;
}

async function resolveImage(
  value: unknown,
  path: string,
  errors: FieldError[],
  opts: { required: boolean; auctionId: string; store: PgStore; existing: Map<string, { buffer: Buffer; mime: string; name: string }> },
): Promise<{ buffer: Buffer; mime: string; name: string } | null> {
  if (value === null || value === undefined) {
    if (opts.required) errors.push({ path, message: "image required" });
    return null;
  }
  const payload = value as ImagePayload;
  // Staged upload reference: { uploadId }
  if (typeof payload.uploadId === "string" && payload.uploadId) {
    try {
      const upload = await opts.store.teams.getTeamImageUpload(payload.uploadId);
      if (upload.auctionId !== opts.auctionId) {
        errors.push({ path, message: "invalid image" });
        return null;
      }
      // Staged rows older than 24h are treated as expired so the user
      // re-uploads instead of silently reusing a pruned row.
      if (Date.now() - Date.parse(upload.createdAt) > 24 * 60 * 60 * 1000) {
        errors.push({ path, message: "image expired" });
        return null;
      }
      return checkedImage({ buffer: upload.buffer, mime: upload.mime, name: upload.name }, path, errors);
    } catch {
      errors.push({ path, message: "invalid image" });
      return null;
    }
  }
  // Reuse of an already-saved image in the same auction: { teamId } / { memberId }.
  const reuseKey =
    typeof payload.teamId === "string" && payload.teamId
      ? `team:${payload.teamId}`
      : typeof payload.memberId === "string" && payload.memberId
        ? `member:${payload.memberId}`
        : null;
  if (reuseKey) {
    const found = opts.existing.get(reuseKey);
    if (!found) {
      errors.push({ path, message: "invalid image" });
      return null;
    }
    return checkedImage(found, path, errors);
  }
  // Legacy inline base64 payload: { data, mime, name }.
  const mime = typeof payload.mime === "string" ? payload.mime : "";
  const name = typeof payload.name === "string" ? payload.name : "";
  const buffer = typeof payload.data === "string" ? strictBase64(payload.data) : null;
  if (!buffer) {
    errors.push({ path, message: "image required" });
    return null;
  }
  return checkedImage({ buffer, mime, name }, path, errors);
}

async function parseTeams(
  store: PgStore,
  auctionId: string,
  body: unknown,
): Promise<{ teams: AuctionTeam[]; errors: FieldError[]; uploadIds: string[] }> {
  const errors: FieldError[] = [];
  const uploadIds: string[] = [];
  const raw = (body as { teams?: unknown } | null)?.teams;
  if (!Array.isArray(raw) || raw.length !== 2) {
    return { teams: [], errors, uploadIds };
  }
  // Index already-saved images so unchanged flags/avatars can be reused by
  // reference without re-uploading bytes.
  const existing = new Map<string, { buffer: Buffer; mime: string; name: string }>();
  try {
    const saved = await store.teams.getAuctionTeams(auctionId);
    for (const team of saved) {
      existing.set(`team:${team.id}`, { buffer: team.flag.buffer, mime: team.flag.mime, name: team.flag.name });
      for (const m of team.members) {
        if (m.avatar.buffer) {
          existing.set(`member:${m.id}`, {
            buffer: m.avatar.buffer,
            mime: m.avatar.mime ?? "",
            name: m.avatar.name ?? "",
          });
        }
      }
    }
  } catch {
    // Missing auction surfaces later as a 404; reuse simply stays empty.
  }
  const teams: AuctionTeam[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const t = (entry ?? {}) as Record<string, unknown>;
    const path = `teams[${i}]`;
    const name = typeof t.name === "string" ? t.name : "";
    if (!name.trim()) errors.push({ path: `${path}.name`, message: "team name is required" });
    else if (name.length > 200) errors.push({ path: `${path}.name`, message: "team name too long" });
    const sloganRaw = t.slogan;
    const slogan = typeof sloganRaw === "string" ? sloganRaw : "";
    if (!slogan.trim()) errors.push({ path: `${path}.slogan`, message: "slogan is required" });
    else if (slogan.length > 500) errors.push({ path: `${path}.slogan`, message: "slogan too long" });
    if (t.position !== i) errors.push({ path: `${path}.position`, message: "team position must match its panel" });
    const flag = await resolveImage(t.flag, `${path}.flag`, errors, {
      required: true,
      auctionId,
      store,
      existing,
    });
    const flagRaw = t.flag as ImagePayload | null | undefined;
    if (flagRaw && typeof flagRaw.uploadId === "string" && flagRaw.uploadId) uploadIds.push(flagRaw.uploadId);

    const membersRaw = Array.isArray(t.members) ? (t.members as unknown[]) : null;
    if (!membersRaw || membersRaw.length === 0) {
      errors.push({ path: `${path}.members`, message: "team must have at least one member" });
    }
    const members: AuctionTeam["members"] = [];
    for (let j = 0; j < (membersRaw ?? []).length; j++) {
      const mEntry = (membersRaw ?? [])[j];
      const m = ((mEntry ?? {}) as Record<string, unknown>);
      const mPath = `${path}.members[${j}]`;
      const memberName = typeof m.name === "string" ? m.name : "";
      if (!memberName.trim()) errors.push({ path: `${mPath}.name`, message: "member name is required" });
      else if (memberName.length > 200) errors.push({ path: `${mPath}.name`, message: "member name too long" });
      const gold = typeof m.initialGold === "number" ? m.initialGold : Number.NaN;
      if (!Number.isInteger(gold) || gold <= 0) {
        errors.push({ path: `${mPath}.initialGold`, message: "invalid initial gold" });
      }
      const avatar = await resolveImage(m.avatar, `${mPath}.avatar`, errors, {
        required: false,
        auctionId,
        store,
        existing,
      });
      const avatarRaw = m.avatar as ImagePayload | null | undefined;
      if (avatarRaw && typeof avatarRaw.uploadId === "string" && avatarRaw.uploadId) uploadIds.push(avatarRaw.uploadId);
      members.push({
        id: "",
        teamId: "",
        name: memberName,
        avatar: avatar ?? { buffer: null, mime: null, name: null },
        initialGold: Number.isInteger(gold) ? gold : 0,
        createdAt: new Date(0).toISOString(),
      });
    }

    teams.push({
      id: "",
      auctionId: "",
      name,
      slogan: slogan.trim() ? slogan.trim() : null,
      flag: flag ?? { buffer: Buffer.alloc(0), mime: "", name: "" },
      position: i as 0 | 1,
      members,
      createdAt: new Date(0).toISOString(),
    });
  }
  if (errors.length === 0) {
    const totals = teams.map((team) => team.members.reduce((sum, m) => sum + m.initialGold, 0));
    if (totals[0] !== totals[1]) {
      errors.push({ path: "teams", message: "starting budgets must be equal" });
    }
  }
  return { teams, errors, uploadIds };
}

// Lightweight summaries: no base64 bytes. Images are fetched per file so a
// large gallery can never blow the JSON body budget again.
function serializeTeamSummaries(auctionId: string, teams: AuctionTeam[]) {
  return teams.map((team) => ({
    id: team.id,
    auctionId: team.auctionId,
    name: team.name,
    slogan: team.slogan,
    position: team.position,
    flag: {
      mime: team.flag.mime,
      name: team.flag.name,
      size: team.flag.buffer.length,
      url: `/auctions/${auctionId}/teams/${team.id}/flag`,
    },
    members: team.members.map((m) => ({
      id: m.id,
      teamId: m.teamId,
      name: m.name,
      initialGold: m.initialGold,
      avatar: m.avatar.buffer
        ? {
            mime: m.avatar.mime,
            name: m.avatar.name,
            size: m.avatar.buffer.length,
            url: `/auctions/${auctionId}/teams/${m.teamId}/members/${m.id}/avatar`,
          }
        : null,
    })),
  }));
}

function sendImage(res: express.Response, image: { buffer: Buffer; mime: string; name: string } | null): void {
  if (!image) {
    res.status(404).json({ error: "image not found" });
    return;
  }
  res.setHeader("Content-Type", image.mime || "image/png");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.send(image.buffer);
}

export function mountTeamRoutes(app: express.Express, store: PgStore): void {
  app.get("/auctions/:id/teams", async (req, res) => {
    try {
      const teams = await store.teams.getAuctionTeams(req.params.id);
      const body = serializeTeamSummaries(req.params.id, teams);
      if (jsonUtf8Bytes(body) > REQUEST_BODY_BUDGET_BYTES) {
        return res.status(413).json({ error: "response too large" });
      }
      res.json(body);
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      if (e instanceof PayloadTooLargeError) {
        return res.status(413).json({ error: e.message });
      }
      res.status(500).json({ error: "persistence failed" });
    }
  });

  // Independent single-file upload. Validates type/size immediately and
  // returns a short-lived reference; the team save consumes it by id.
  app.post("/auctions/:id/team-images", (req, res) => {
    uploadSingle("image")(req, res, async (err: unknown) => {
      if (err) {
        if (isMulterFileSizeError(err)) return res.status(413).json({ error: "image too large" });
        if (err instanceof PayloadTooLargeError) return res.status(413).json({ error: err.message });
        return res.status(400).json({ error: "upload failed" });
      }
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: "image required" });
        const saved = await store.teams.saveTeamImageUpload(req.params.id, {
          buffer: file.buffer,
          mime: file.mimetype,
          name: file.originalname,
        });
        res.status(201).json({
          uploadId: saved.id,
          mime: saved.mime,
          name: saved.name,
          size: saved.buffer.length,
          url: `/auctions/${req.params.id}/team-images/${saved.id}/image`,
        });
      } catch (e) {
        if (e instanceof AssetError) {
          const h = assetErrorHttp(e);
          // "invalid image" maps to 400 via assetErrorHttp; unknown codes fall
          // through to persistence failure below.
          if (h.status !== 500) return res.status(h.status).json({ error: h.body });
        }
        if (e instanceof PayloadTooLargeError) {
          return res.status(413).json({ error: e.message });
        }
        const msg = (e as Error).message ?? "";
        if (msg === "invalid image") return res.status(400).json({ error: "invalid image" });
        if (e instanceof AssetError) {
          const h = assetErrorHttp(e);
          return res.status(h.status).json({ error: h.body });
        }
        res.status(500).json({ error: "persistence failed" });
      }
    });
  });

  app.get("/auctions/:id/team-images/:uploadId/image", async (req, res) => {
    try {
      const upload = await store.teams.getTeamImageUpload(req.params.uploadId);
      if (upload.auctionId !== req.params.id) return res.status(404).json({ error: "image not found" });
      sendImage(res, { buffer: upload.buffer, mime: upload.mime, name: upload.name });
    } catch {
      res.status(404).json({ error: "image not found" });
    }
  });

  app.get("/auctions/:id/teams/:teamId/flag", async (req, res) => {
    try {
      const teams = await store.teams.getAuctionTeams(req.params.id);
      if (!teams.some((team) => team.id === req.params.teamId)) {
        return res.status(404).json({ error: "image not found" });
      }
      sendImage(res, await store.teams.getTeamFlagImage(req.params.teamId));
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "image not found" });
    }
  });

  app.get("/auctions/:id/teams/:teamId/members/:memberId/avatar", async (req, res) => {
    try {
      const teams = await store.teams.getAuctionTeams(req.params.id);
      const team = teams.find((t) => t.id === req.params.teamId);
      if (!team || !team.members.some((m) => m.id === req.params.memberId)) {
        return res.status(404).json({ error: "image not found" });
      }
      sendImage(res, await store.teams.getMemberAvatarImage(req.params.memberId));
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      res.status(404).json({ error: "image not found" });
    }
  });

  app.post("/auctions/:id/teams", async (req, res) => {
    try {
      const raw = req.body?.teams;
      if (!Array.isArray(raw) || raw.length !== 2) {
        return res.status(400).json({ error: "exactly two teams are required" });
      }
      const { teams, errors, uploadIds } = await parseTeams(store, req.params.id, req.body);
      if (errors.length > 0) {
        return res.status(400).json({ error: "invalid teams", fieldErrors: errors });
      }
      // No combined-size check here by design: images arrive via separate
      // single-file uploads (or reuse references), so the request JSON is
      // tiny. Resolved buffers go straight to Postgres BYTEA and the
      // response below is lightweight summaries. Oversized legacy inline
      // base64 payloads are still caught by the global JSON body budget in
      // app.ts before this handler runs.
      const saved = await store.teams.saveAuctionTeams(req.params.id, teams);
      // Consumed staged uploads are deleted best-effort; expiry pruning
      // happens on upload, so a failed delete never blocks the save.
      if (uploadIds.length > 0) {
        await store.teams.deleteTeamImageUploads([...new Set(uploadIds)]).catch(() => undefined);
      }
      const body = serializeTeamSummaries(req.params.id, saved);
      if (jsonUtf8Bytes(body) > REQUEST_BODY_BUDGET_BYTES) {
        return res.status(413).json({ error: "response too large" });
      }
      res.json(body);
    } catch (e) {
      if (e instanceof AssetError) {
        const h = assetErrorHttp(e);
        return res.status(h.status).json({ error: h.body });
      }
      if (e instanceof PayloadTooLargeError) {
        return res.status(413).json({ error: e.message });
      }
      res.status(500).json({ error: "persistence failed" });
    }
  });
}
