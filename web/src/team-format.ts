// Pure helpers for the team preparation step (no React dependency so
// logic-only tests can import this module directly).

export interface GoldMember {
  goldText: string;
}

export interface GoldTeam {
  members: GoldMember[];
}

export function parseGold(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function teamTotal(team: GoldTeam): number {
  return team.members.reduce((sum, m) => sum + (parseGold(m.goldText) ?? 0), 0);
}
