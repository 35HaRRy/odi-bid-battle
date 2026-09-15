import { randomUUID } from "node:crypto";

export interface Candidate {
  id: string;
  name: string;
}

export interface CandidateList {
  id: string;
  name: string;
  entries: string[];
  isDraft: boolean;
}

function assertName(name: string): void {
  if (!name || name.trim().length === 0 || name.length > 200) {
    throw new Error("invalid name");
  }
}

export function createCandidate(name: string): Candidate {
  assertName(name);
  return { id: randomUUID(), name: name.trim() };
}

export function createCandidateList(
  name: string,
  opts: { draft?: boolean } = {},
): CandidateList {
  const draft = opts.draft ?? true;
  if (!draft) assertName(name);
  if (name.length > 200) throw new Error("invalid name");
  return { id: randomUUID(), name, entries: [], isDraft: draft };
}

export function buildListCopyName(sourceName: string): string {
  const base = sourceName.trim() || "Taslak";
  return `${base} — Kopya`.slice(0, 200);
}

export function addEntry(list: CandidateList, candidateId: string): void {
  if (list.entries.includes(candidateId)) throw new Error("duplicate entry");
  list.entries.push(candidateId);
}

export function removeEntry(list: CandidateList, candidateId: string): void {
  list.entries = list.entries.filter((e) => e !== candidateId);
}

export function reorderEntry(
  list: CandidateList,
  candidateId: string,
  toIndex: number,
): void {
  const from = list.entries.indexOf(candidateId);
  if (from === -1) throw new Error("entry not found");
  const clamped = Math.max(0, Math.min(toIndex, list.entries.length - 1));
  list.entries.splice(from, 1);
  list.entries.splice(clamped, 0, candidateId);
}

export function shouldCopyCandidateOnEdit(referenced: boolean): boolean {
  return referenced;
}

export function replaceEntryId(
  entries: string[],
  oldId: string,
  newId: string,
): string[] {
  if (!entries.includes(oldId)) throw new Error("entry not found");
  if (oldId !== newId && entries.includes(newId))
    throw new Error("duplicate entry");
  return entries.map((e) => (e === oldId ? newId : e));
}

export interface AuctionDraft {
  id: string;
  name: string;
  sourceListId: string | null;
  followsSource: boolean;
  entries: string[];
  battlefieldId: string | null;
  status: "draft" | "ongoing" | "completed";
}

export function createAuctionDraft(
  name: string,
  sourceEntries: string[],
  sourceListId: string | null,
): AuctionDraft {
  if (name.length > 200) throw new Error("invalid name");
  return {
    id: randomUUID(),
    name,
    sourceListId,
    followsSource: sourceListId !== null,
    entries: [...sourceEntries],
    battlefieldId: null,
    status: "draft",
  };
}

function forkDraft(draft: AuctionDraft): void {
  draft.followsSource = false;
}

export function renameDraft(draft: AuctionDraft, name: string): void {
  if (name.length > 200) throw new Error("invalid name");
  if (draft.followsSource) forkDraft(draft);
  draft.name = name;
}

export function syncFollowedDraft(
  draft: AuctionDraft,
  sourceEntries: string[],
): void {
  if (draft.followsSource) draft.entries = [...sourceEntries];
}

export function addEntryToDraft(
  draft: AuctionDraft,
  candidateId: string,
): void {
  if (draft.followsSource) forkDraft(draft);
  if (draft.entries.includes(candidateId)) throw new Error("duplicate entry");
  draft.entries.push(candidateId);
}

export function removeEntryFromDraft(
  draft: AuctionDraft,
  candidateId: string,
): void {
  if (draft.followsSource) forkDraft(draft);
  draft.entries = draft.entries.filter((e) => e !== candidateId);
}

export function reorderEntryInDraft(
  draft: AuctionDraft,
  candidateId: string,
  toIndex: number,
): void {
  if (draft.followsSource) forkDraft(draft);
  const from = draft.entries.indexOf(candidateId);
  if (from === -1) throw new Error("entry not found");
  const clamped = Math.max(0, Math.min(toIndex, draft.entries.length - 1));
  draft.entries.splice(from, 1);
  draft.entries.splice(clamped, 0, candidateId);
}

export interface AuctionTeam {
  id: string;
  auctionId: string;
  name: string;
  slogan: string | null;
  flag: { buffer: Buffer; mime: string; name: string };
  position: 0 | 1;
  members: AuctionTeamMember[];
  createdAt: string;
}

export interface AuctionTeamMember {
  id: string;
  teamId: string;
  name: string;
  avatar: { buffer: Buffer | null; mime: string | null; name: string | null };
  initialGold: number;
  createdAt: string;
}

export function createAuctionTeam(
  auctionId: string,
  name: string,
  position: 0 | 1,
  opts: { slogan?: string; flag?: { buffer: Buffer; mime: string; name: string } } = {}
): AuctionTeam {
  if (!name.trim()) throw new Error("team name is required");
  if (name.length > 200) throw new Error("invalid team name");
  if (opts.slogan && opts.slogan.length > 500) throw new Error("invalid slogan");
  if (!opts.flag?.buffer || opts.flag.buffer.length === 0) throw new Error("flag is required");
  return {
    id: randomUUID(),
    auctionId,
    name: name.trim(),
    slogan: opts.slogan?.trim() || null,
    flag: opts.flag,
    position,
    members: [],
    createdAt: new Date().toISOString(),
  };
}

export function addTeamMember(
  team: AuctionTeam,
  name: string,
  initialGold = 10,
  opts: { avatar?: { buffer: Buffer | null; mime: string | null; name: string | null } } = {}
): AuctionTeamMember {
  if (!name.trim()) throw new Error("member name is required");
  if (name.length > 200) throw new Error("invalid member name");
  if (!isValidInitialGold(initialGold)) throw new Error("invalid initial gold");
  const member: AuctionTeamMember = {
    id: randomUUID(),
    teamId: team.id,
    name: name.trim(),
    avatar: opts.avatar || { buffer: null, mime: null, name: null },
    initialGold,
    createdAt: new Date().toISOString(),
  };
  team.members.push(member);
  return member;
}

export function transferMember(
  members: AuctionTeamMember[],
  memberId: string,
  toPosition: 0 | 1
): AuctionTeamMember[] {
  const fromIdx = members.findIndex((m) => m.id === memberId);
  if (fromIdx === -1) throw new Error("member not found");

  const [member] = members.splice(fromIdx, 1);
  members.splice(toPosition, 0, member);
  return members;
}

export function transferMemberBetweenTeams(
  from: AuctionTeam,
  to: AuctionTeam,
  memberId: string
): void {
  const idx = from.members.findIndex((m) => m.id === memberId);
  if (idx === -1) throw new Error("member not found");
  const [member] = from.members.splice(idx, 1);
  member.teamId = to.id;
  to.members.push(member);
}

export function isValidInitialGold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function calculateTeamTotal(members: AuctionTeamMember[]): number {
  return members.reduce((sum, m) => sum + m.initialGold, 0);
}

export function validateTeamBalance(
  team1: AuctionTeam,
  team2: AuctionTeam
): { valid: boolean; error?: string } {
  const total1 = calculateTeamTotal(team1.members);
  const total2 = calculateTeamTotal(team2.members);
  
  if (total1 !== total2) {
    return {
      valid: false,
      error: `team balance constraint: both teams must have equal total gold (${total1} vs ${total2})`,
    };
  }
  
  return { valid: true };
}

export interface TeamBalance {
  total1: number;
  total2: number;
  equal: boolean;
  difference: number;
}

export interface TeamDraftValidation {
  valid: boolean;
  errors: string[];
  balance: TeamBalance;
}

function teamBalanceOf(teams: AuctionTeam[]): TeamBalance {
  const total1 = teams.length > 0 ? calculateTeamTotal(teams[0].members) : 0;
  const total2 = teams.length > 1 ? calculateTeamTotal(teams[1].members) : 0;
  return { total1, total2, equal: total1 === total2, difference: Math.abs(total1 - total2) };
}

// Draft saving allows temporary inequality; only field-level problems block it.
export function validateTeamDraft(teams: AuctionTeam[]): TeamDraftValidation {
  const errors: string[] = [];

  if (teams.length !== 2) errors.push("exactly two teams are required");

  // Check team names and slogans
  for (const team of teams) {
    if (!team.name.trim()) errors.push("team name is required");
    if (team.name.length > 200) errors.push("team name too long");
  }

  // Check team flags
  for (const team of teams) {
    if (!team.flag.buffer || team.flag.buffer.length === 0) {
      errors.push(`team "${team.name || 'unnamed'}" flag is required`);
    }
  }

  // Check each team has at least one member
  for (const team of teams) {
    if (team.members.length === 0) {
      errors.push(`team "${team.name}" must have at least one member`);
    }
  }

  // Check member names and gold
  for (const team of teams) {
    for (const member of team.members) {
      if (!member.name.trim()) errors.push(`member name in team "${team.name}" is required`);
      if (!isValidInitialGold(member.initialGold)) {
        errors.push(`invalid initial gold for member "${member.name}" in team "${team.name}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors, balance: teamBalanceOf(teams) };
}

// Readiness for review/start adds the equal-budget rule on top of draft rules.
export function validateAuctionPreparation(
  auction: AuctionDraft,
  teams: AuctionTeam[]
): { valid: boolean; errors: string[] } {
  const draft = validateTeamDraft(teams);
  const errors = [...draft.errors];

  if (teams.length === 2) {
    const validation = validateTeamBalance(teams[0], teams[1]);
    if (!validation.valid) {
      errors.push(validation.error || "teams must have equal total gold");
    }
  }

  return { valid: errors.length === 0, errors };
}

export interface StartFieldError {
  path: string;
  message: string;
}

export interface StartCandidateInfo {
  id: string;
  name: string;
  hasImage: boolean;
}

export interface StartBattlefieldInfo {
  id: string;
  name: string;
  geography: string;
  history: string;
  hasImage: boolean;
  archivedAt: string | null;
}

export interface StartReadinessInput {
  auction: { name: string };
  entries: string[];
  candidates: StartCandidateInfo[];
  battlefield: StartBattlefieldInfo | null;
  backgroundAvailable: boolean;
  teams: AuctionTeam[];
}

export class StartValidationError extends Error {
  readonly errors: string[];
  readonly fieldErrors: StartFieldError[];
  constructor(errors: string[], fieldErrors: StartFieldError[]) {
    super("invalid preparation");
    this.name = "StartValidationError";
    this.errors = errors;
    this.fieldErrors = fieldErrors;
  }
}

export function validateStartReadiness(input: StartReadinessInput): {
  valid: boolean;
  errors: string[];
  fieldErrors: StartFieldError[];
} {
  const errors: string[] = [];
  const fieldErrors: StartFieldError[] = [];
  const fail = (path: string, message: string) => {
    errors.push(message);
    fieldErrors.push({ path, message });
  };

  const name = input.auction.name ?? "";
  if (!name.trim()) fail("auction.name", "auction name is required");
  else if (name.length > 200) fail("auction.name", "auction name too long");

  if (!input.battlefield) {
    fail("battlefield", "battlefield is required");
  } else {
    const b = input.battlefield;
    if (!b.name.trim()) fail("battlefield.name", "battlefield name is required");
    if (!b.geography.trim()) fail("battlefield.geography", "battlefield geography is required");
    if (!b.history.trim()) fail("battlefield.history", "battlefield history is required");
    if (!b.hasImage) fail("battlefield.image", "battlefield image is required");
  }
  if (!input.backgroundAvailable) fail("background", "background image is required");

  if (input.entries.length < 4 || input.entries.length % 2 !== 0) {
    fail("entries", "candidate list must contain an even number of candidates, at least four");
  }
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  for (const id of input.entries) {
    const c = byId.get(id);
    if (!c) {
      fail("entries", `candidate ${id} not found`);
      continue;
    }
    if (!c.name.trim()) fail(`candidates.${id}.name`, `candidate ${id} name is required`);
    if (!c.hasImage) fail(`candidates.${id}.image`, `candidate ${id} image is required`);
  }

  const draft = validateTeamDraft(input.teams);
  for (const e of draft.errors) errors.push(e);
  // Map draft team errors to field paths best-effort by re-checking.
  if (input.teams.length !== 2) {
    fieldErrors.push({ path: "teams", message: "exactly two teams are required" });
  } else {
    const [t1, t2] = input.teams;
    [t1, t2].forEach((team, i) => {
      const p = `teams[${i}]`;
      if (!team.name.trim()) fieldErrors.push({ path: `${p}.name`, message: "team name is required" });
      if (!(team.slogan ?? "").trim()) fieldErrors.push({ path: `${p}.slogan`, message: "slogan is required" });
      if (!team.flag.buffer || team.flag.buffer.length === 0)
        fieldErrors.push({ path: `${p}.flag`, message: "team flag is required" });
      if (team.members.length === 0)
        fieldErrors.push({ path: `${p}.members`, message: "team must have at least one member" });
      team.members.forEach((m, j) => {
        if (!m.name.trim())
          fieldErrors.push({ path: `${p}.members[${j}].name`, message: "member name is required" });
        if (!isValidInitialGold(m.initialGold))
          fieldErrors.push({ path: `${p}.members[${j}].initialGold`, message: "invalid initial gold" });
      });
    });
    const balance = validateTeamBalance(t1, t2);
    if (!balance.valid) {
      errors.push(balance.error || "teams must have equal total gold");
      fieldErrors.push({ path: "teams", message: balance.error || "teams must have equal total gold" });
    }
  }

  return { valid: errors.length === 0, errors, fieldErrors };
}
