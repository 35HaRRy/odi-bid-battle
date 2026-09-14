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

export interface ValidatableMember {
  name: string;
  goldText: string;
}

export interface ValidatableTeam {
  name: string;
  slogan: string;
  flag: unknown | null;
  members: ValidatableMember[];
}

export function isTeamsFormValid(teams: ValidatableTeam[]): boolean {
  if (!Array.isArray(teams) || teams.length !== 2) return false;
  for (const team of teams) {
    if (!team.name.trim()) return false;
    if (!team.slogan.trim()) return false;
    if (!team.flag) return false;
    if (team.members.length === 0) return false;
    for (const m of team.members) {
      if (!m.name.trim()) return false;
      if (parseGold(m.goldText) === null) return false;
    }
  }
  const totals = teams.map((team) =>
    team.members.reduce((sum, m) => sum + (parseGold(m.goldText) ?? 0), 0),
  );
  return totals[0] === totals[1];
}
