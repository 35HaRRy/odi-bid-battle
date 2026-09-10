const BASE =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? `http ${res.status}`,
    );
  }
  return res;
}

export interface Candidate {
  id: string;
  name: string;
}
export interface CandidateList {
  id: string;
  name: string;
  isDraft: boolean;
  entries: string[];
}

export const api = {
  base: BASE,
  imageUrl: (id: string) => `${BASE}/candidates/${id}/image`,
  async candidates(): Promise<Candidate[]> {
    const r = await check(await fetch(`${BASE}/candidates`));
    return r.json();
  },
  async createCandidate(name: string, file: File): Promise<Candidate> {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("image", file);
    const r = await check(
      await fetch(`${BASE}/candidates`, { method: "POST", body: fd }),
    );
    return r.json();
  },
  async archiveCandidate(id: string): Promise<void> {
    await check(
      await fetch(`${BASE}/candidates/${id}/archive`, { method: "POST" }),
    );
  },
  async lists(): Promise<CandidateList[]> {
    const r = await check(await fetch(`${BASE}/lists`));
    return r.json();
  },
  async createList(name: string, isDraft: boolean): Promise<CandidateList> {
    const r = await check(
      await fetch(`${BASE}/lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, isDraft }),
      }),
    );
    return r.json();
  },
  async getList(id: string): Promise<CandidateList> {
    const r = await check(await fetch(`${BASE}/lists/${id}`));
    return r.json();
  },
  async addEntry(listId: string, candidateId: string): Promise<CandidateList> {
    const r = await check(
      await fetch(`${BASE}/lists/${listId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      }),
    );
    return r.json();
  },
  async removeEntry(
    listId: string,
    candidateId: string,
  ): Promise<CandidateList> {
    const r = await check(
      await fetch(`${BASE}/lists/${listId}/entries/${candidateId}`, {
        method: "DELETE",
      }),
    );
    return r.json();
  },
  async reorder(
    listId: string,
    candidateId: string,
    toIndex: number,
  ): Promise<CandidateList> {
    const r = await check(
      await fetch(`${BASE}/lists/${listId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, toIndex }),
      }),
    );
    return r.json();
  },
};
