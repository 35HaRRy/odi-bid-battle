import type { AuctionTeam } from "./domain.js";

// Vercel Functions request/response body ceiling is 4.5 MB. The budgets
// below are deliberately smaller so multipart framing overhead and base64
// inflation can never push a request or response over the platform limit.
// These same constants apply locally: Vercel-sourced limits are enforced
// in every environment.
export const REQUEST_BODY_BUDGET_BYTES = 4_000_000;
export const SINGLE_FILE_LIMIT_BYTES = 3_500_000;

export class PayloadTooLargeError extends Error {
  constructor(message = "payload too large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function jsonUtf8Bytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value));
}

export function assertRequestBudget(bytes: number): void {
  if (bytes > REQUEST_BODY_BUDGET_BYTES) {
    throw new PayloadTooLargeError();
  }
}

export function assertFileBudget(bytes: number): void {
  if (bytes > SINGLE_FILE_LIMIT_BYTES) {
    throw new PayloadTooLargeError("image too large");
  }
}

// Approximate the serialized team payload (base64 flags/avatars plus JSON
// framing) so oversized data is rejected before it is persisted. The shape
// mirrors serializeTeams in team-routes.ts without importing it.
export function estimateSerializedTeamsBytes(teams: AuctionTeam[]): number {
  const approx = teams.map((team) => ({
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
        ? {
            data: m.avatar.buffer.toString("base64"),
            mime: m.avatar.mime,
            name: m.avatar.name,
          }
        : null,
    })),
  }));
  return jsonUtf8Bytes(approx);
}
