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
