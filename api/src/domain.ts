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
