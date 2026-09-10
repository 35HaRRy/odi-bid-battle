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
export interface Auction {
  id: string;
  name: string;
  sourceListId: string | null;
  followsSource: boolean;
  entries: string[];
  battlefieldId: string | null;
  status: string;
}

function editForm(name: string, file: File | null): FormData {
  const fd = new FormData();
  fd.append("name", name);
  if (file) fd.append("image", file);
  return fd;
}

export const api = {
  base: BASE,
  imageUrl: (id: string) => `${BASE}/candidates/${id}/image`,
  async candidates(): Promise<Candidate[]> {
    const r = await check(await fetch(`${BASE}/candidates`));
    return r.json();
  },
  async getCandidate(id: string): Promise<Candidate> {
    const r = await check(await fetch(`${BASE}/candidates/${id}`));
    return r.json();
  },
  async editCatalogCandidate(
    id: string,
    name: string,
    file: File | null,
  ): Promise<Candidate> {
    const r = await check(
      await fetch(`${BASE}/candidates/${id}/edit`, {
        method: "POST",
        body: editForm(name, file),
      }),
    );
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
  async archiveList(id: string): Promise<void> {
    await check(await fetch(`${BASE}/lists/${id}/archive`, { method: "POST" }));
  },
  async editListEntry(
    listId: string,
    candidateId: string,
    name: string,
    file: File | null,
  ): Promise<{ candidate: Candidate; list: CandidateList }> {
    const r = await check(
      await fetch(`${BASE}/lists/${listId}/entries/${candidateId}/edit`, {
        method: "POST",
        body: editForm(name, file),
      }),
    );
    return r.json();
  },
  async auctions(): Promise<Auction[]> {
    const r = await check(await fetch(`${BASE}/auctions`));
    return r.json();
  },
  async createAuction(name: string, sourceListId: string | null): Promise<Auction> {
    const r = await check(
      await fetch(`${BASE}/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sourceListId }),
      }),
    );
    return r.json();
  },
  async getAuction(id: string): Promise<Auction> {
    const r = await check(await fetch(`${BASE}/auctions/${id}`));
    return r.json();
  },
  async renameAuction(id: string, name: string): Promise<Auction> {
    const r = await check(
      await fetch(`${BASE}/auctions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    );
    return r.json();
  },
  async addAuctionEntry(auctionId: string, candidateId: string): Promise<Auction> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      }),
    );
    return r.json();
  },
  async removeAuctionEntry(
    auctionId: string,
    candidateId: string,
  ): Promise<Auction> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/entries/${candidateId}`, {
        method: "DELETE",
      }),
    );
    return r.json();
  },
  async reorderAuction(
    auctionId: string,
    candidateId: string,
    toIndex: number,
  ): Promise<Auction> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, toIndex }),
      }),
    );
    return r.json();
  },
  async editAuctionEntry(
    auctionId: string,
    candidateId: string,
    name: string,
    file: File | null,
  ): Promise<{ candidate: Candidate; auction: Auction }> {
    const r = await check(
      await fetch(
        `${BASE}/auctions/${auctionId}/entries/${candidateId}/edit`,
        { method: "POST", body: editForm(name, file) },
      ),
    );
    return r.json();
  },
};
