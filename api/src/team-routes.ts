import express from "express";
import { PgStore } from "./store.js";
import { AssetError, validateAssetImage } from "./battlefield-domain.js";
import { assetErrorHttp } from "./battlefield-routes.js";
import type { AuctionTeam } from "./domain.js";
import {
  REQUEST_BODY_BUDGET_BYTES,
  estimateSerializedTeamsBytes,
  jsonUtf8Bytes,
  PayloadTooLargeError,
} from "./limits.js";

export interface FieldError {
  path: string;
  message: string;
}

interface ImagePayload {
  data: unknown;
  mime: unknown;
  name: unknown;
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

function parseImage(
  value: unknown,
  path: string,
  errors: FieldError[],
  opts: { required: boolean },
): { buffer: Buffer; mime: string; name: string } | null {
  if (value === null || value === undefined) {
    if (opts.required) errors.push({ path, message: "image required" });
    return null;
  }
  const payload = value as ImagePayload;
  const mime = typeof payload.mime === "string" ? payload.mime : "";
  const name = typeof payload.name === "string" ? payload.name : "";
  const buffer =
    typeof payload.data === "string" ? strictBase64(payload.data) : null;
  if (!buffer) {
    errors.push({ path, message: "image required" });
    return null;
  }
  try {
    validateAssetImage({ buffer, mime, name });
  } catch (e) {
    errors.push({ path, message: (e as AssetError).code ?? "invalid image" });
    return null;
  }
  if (!name.trim()) {
    errors.push({ path, message: "image name required" });
    return null;
  }
  return { buffer, mime, name };
}

function parseTeams(body: unknown): { teams: AuctionTeam[]; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const raw = (body as { teams?: unknown } | null)?.teams;
  if (!Array.isArray(raw) || raw.length !== 2) {
    return { teams: [], errors };
  }
  const teams: AuctionTeam[] = raw.map((entry, i) => {
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
    const flag = parseImage(t.flag, `${path}.flag`, errors, { required: true });

    const membersRaw = Array.isArray(t.members) ? (t.members as unknown[]) : null;
    if (!membersRaw || membersRaw.length === 0) {
      errors.push({ path: `${path}.members`, message: "team must have at least one member" });
    }
    const members: AuctionTeam["members"] = (membersRaw ?? []).map((mEntry, j) => {
      const m = ((mEntry ?? {}) as Record<string, unknown>);
      const mPath = `${path}.members[${j}]`;
      const memberName = typeof m.name === "string" ? m.name : "";
      if (!memberName.trim()) errors.push({ path: `${mPath}.name`, message: "member name is required" });
      else if (memberName.length > 200) errors.push({ path: `${mPath}.name`, message: "member name too long" });
      const gold = typeof m.initialGold === "number" ? m.initialGold : Number.NaN;
      if (!Number.isInteger(gold) || gold <= 0) {
        errors.push({ path: `${mPath}.initialGold`, message: "invalid initial gold" });
      }
      const avatar = parseImage(m.avatar, `${mPath}.avatar`, errors, { required: false });
      return {
        id: "",
        teamId: "",
        name: memberName,
        avatar: avatar ?? { buffer: null, mime: null, name: null },
        initialGold: Number.isInteger(gold) ? gold : 0,
        createdAt: new Date(0).toISOString(),
      };
    });

    return {
      id: "",
      auctionId: "",
      name,
      slogan: slogan.trim() ? slogan.trim() : null,
      flag: flag ?? { buffer: Buffer.alloc(0), mime: "", name: "" },
      position: i as 0 | 1,
      members,
      createdAt: new Date(0).toISOString(),
    };
  });
  if (errors.length === 0) {
    const totals = teams.map((team) => team.members.reduce((sum, m) => sum + m.initialGold, 0));
    if (totals[0] !== totals[1]) {
      errors.push({ path: "teams", message: "starting budgets must be equal" });
    }
  }
  return { teams, errors };
}

function serializeTeams(teams: AuctionTeam[]) {
  return teams.map((team) => ({
    id: team.id,
    auctionId: team.auctionId,
    name: team.name,
    slogan: team.slogan,
    position: team.position,
    flag: {
      data: team.flag.buffer.toString("base64"),
      mime: team.flag.mime,
      name: team.flag.name,
    },
    members: team.members.map((m) => ({
      id: m.id,
      teamId: m.teamId,
      name: m.name,
      initialGold: m.initialGold,
      avatar: m.avatar.buffer
        ? { data: m.avatar.buffer.toString("base64"), mime: m.avatar.mime, name: m.avatar.name }
        : null,
    })),
  }));
}

export function mountTeamRoutes(app: express.Express, store: PgStore): void {
  app.get("/auctions/:id/teams", async (req, res) => {
    try {
      const body = serializeTeams(await store.teams.getAuctionTeams(req.params.id));
      // Previously stored oversized images are never silently dropped; the
      // caller gets an explicit incompatibility error instead.
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

  app.post("/auctions/:id/teams", async (req, res) => {
    try {
      const raw = req.body?.teams;
      if (!Array.isArray(raw) || raw.length !== 2) {
        return res.status(400).json({ error: "exactly two teams are required" });
      }
      const { teams, errors } = parseTeams(req.body);
      if (errors.length > 0) {
        return res.status(400).json({ error: "invalid teams", fieldErrors: errors });
      }
      // The saved record round-trips back with base64 images, so the full
      // response is measured before anything is persisted. Rejected saves
      // leave the database untouched.
      if (estimateSerializedTeamsBytes(teams) > REQUEST_BODY_BUDGET_BYTES) {
        return res.status(413).json({ error: "payload too large" });
      }
      const body = serializeTeams(await store.teams.saveAuctionTeams(req.params.id, teams));
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
