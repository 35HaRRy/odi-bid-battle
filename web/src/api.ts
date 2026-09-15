const BASE =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? `http ${res.status}`,
      body,
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
export interface BattlefieldSummary {
  id: string;
  name: string;
  geography: string;
  history: string;
  archivedAt: string | null;
}
export interface DraftBattlefield {
  auctionId: string;
  battlefieldId: string;
  name: string;
  geography: string;
  history: string;
  hasCustomImage: boolean;
  archivedAt: string | null;
}
export interface TeamImagePayload {
  data: string;
  mime: string;
  name: string;
}
export interface TeamMemberPayload {
  name: string;
  initialGold: number;
  avatar: TeamImagePayload | null;
}
export interface TeamPayload {
  name: string;
  slogan: string;
  position: 0 | 1;
  flag: TeamImagePayload | null;
  members: TeamMemberPayload[];
}
export interface SavedTeamMember {
  id: string;
  teamId: string;
  name: string;
  initialGold: number;
  avatar: TeamImagePayload | null;
}
export interface SavedTeam {
  id: string;
  auctionId: string;
  name: string;
  slogan: string | null;
  position: 0 | 1;
  flag: TeamImagePayload;
  members: SavedTeamMember[];
}
export interface FieldError {
  path: string;
  message: string;
}
export interface LiveMember {
  id: string;
  name: string;
  balance: number;
  contribution: number;
}
export interface LiveAcquired {
  candidateId: string;
  name: string;
  price: number;
}
export interface LiveTeam {
  position: 0 | 1;
  name: string;
  remainingGold: number;
  acquiredCount: number;
  acquired: LiveAcquired[];
  members: LiveMember[];
}
export interface LiveState {
  auctionId: string;
  cursor: number;
  active: boolean;
  activeCandidateId: string | null;
  turn: 0 | 1;
  specialPass: boolean;
  latest: { team: 0 | 1; amount: number; contributions: number[] } | null;
  contributions: number[][];
  skipped: string[];
  capacity: number;
  teams: LiveTeam[];
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
  battlefieldImageUrl: (id: string) => `${BASE}/battlefields/${id}/image`,
  draftBattlefieldImageUrl: (auctionId: string, rev = 0) =>
    `${BASE}/auctions/${auctionId}/battlefield/image${rev ? `?r=${rev}` : ""}`,
  auctionBackgroundUrl: (id: string, rev = 0) =>
    `${BASE}/auctions/${id}/background${rev ? `?r=${rev}` : ""}`,
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
  async cloneList(id: string): Promise<CandidateList> {
    const r = await check(
      await fetch(`${BASE}/lists/${id}/clone`, { method: "POST" }),
    );
    return r.json();
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
  async createAuction(
    name: string,
    sourceListId: string | null,
  ): Promise<Auction> {
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
  async deleteAuction(id: string): Promise<void> {
    await check(await fetch(`${BASE}/auctions/${id}`, { method: "DELETE" }));
  },
  async startAuction(id: string): Promise<Auction> {
    const r = await check(
      await fetch(`${BASE}/auctions/${id}/start`, { method: "POST" }),
    );
    return r.json();
  },
  async addAuctionEntry(
    auctionId: string,
    candidateId: string,
  ): Promise<Auction> {
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
  async battlefields(): Promise<BattlefieldSummary[]> {
    const r = await check(await fetch(`${BASE}/battlefields`));
    return r.json();
  },
  async getBattlefield(id: string): Promise<BattlefieldSummary> {
    const r = await check(await fetch(`${BASE}/battlefields/${id}`));
    return r.json();
  },
  async createBattlefield(
    fields: { name: string; geography: string; history: string },
    file: File,
  ): Promise<BattlefieldSummary> {
    const fd = new FormData();
    fd.append("name", fields.name);
    fd.append("geography", fields.geography);
    fd.append("history", fields.history);
    fd.append("image", file);
    const r = await check(
      await fetch(`${BASE}/battlefields`, { method: "POST", body: fd }),
    );
    return r.json();
  },
  async editBattlefield(
    id: string,
    fields: { name: string; geography: string; history: string },
    file: File | null,
  ): Promise<BattlefieldSummary> {
    const fd = new FormData();
    fd.append("name", fields.name);
    fd.append("geography", fields.geography);
    fd.append("history", fields.history);
    if (file) fd.append("image", file);
    const r = await check(
      await fetch(`${BASE}/battlefields/${id}/edit`, {
        method: "POST",
        body: fd,
      }),
    );
    return r.json();
  },
  async archiveBattlefield(id: string): Promise<void> {
    await check(
      await fetch(`${BASE}/battlefields/${id}/archive`, { method: "POST" }),
    );
  },
  async getDraftBattlefield(auctionId: string): Promise<DraftBattlefield> {
    const r = await check(await fetch(`${BASE}/auctions/${auctionId}/battlefield`));
    return r.json();
  },
  async saveDraftBattlefield(
    auctionId: string,
    fields: { geography: string; history: string },
    file: File | null,
  ): Promise<DraftBattlefield> {
    const fd = new FormData();
    fd.append("geography", fields.geography);
    fd.append("history", fields.history);
    if (file) fd.append("image", file);
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/battlefield`, {
        method: "POST",
        body: fd,
      }),
    );
    return r.json();
  },
  async setAuctionBattlefield(
    auctionId: string,
    battlefieldId: string | null,
  ): Promise<Auction> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ battlefieldId }),
      }),
    );
    return r.json();
  },
  async saveAuctionBackground(auctionId: string, file: File): Promise<void> {
    const fd = new FormData();
    fd.append("image", file);
    await check(
      await fetch(`${BASE}/auctions/${auctionId}/background`, {
        method: "POST",
        body: fd,
      }),
    );
  },
  async deleteAuctionBackground(auctionId: string): Promise<void> {
    await check(
      await fetch(`${BASE}/auctions/${auctionId}/background`, {
        method: "DELETE",
      }),
    );
  },
  async getAuctionTeams(auctionId: string): Promise<SavedTeam[]> {
    const r = await check(await fetch(`${BASE}/auctions/${auctionId}/teams`));
    return r.json();
  },
  async saveAuctionTeams(auctionId: string, teams: TeamPayload[]): Promise<SavedTeam[]> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams }),
      }),
    );
    return r.json();
  },
  async getLive(auctionId: string): Promise<LiveState> {
    const r = await check(await fetch(`${BASE}/auctions/${auctionId}/live`));
    return r.json();
  },
  async sendNextCandidate(auctionId: string): Promise<LiveState> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/live/next`, { method: "POST" }),
    );
    return r.json();
  },
  async confirmBid(
    auctionId: string,
    team: 0 | 1,
    contributions: number[],
  ): Promise<LiveState> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/live/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team, contributions }),
      }),
    );
    return r.json();
  },
  async passCandidate(auctionId: string): Promise<LiveState> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/live/pass`, { method: "POST" }),
    );
    return r.json();
  },
  async completeSale(auctionId: string): Promise<LiveState> {
    const r = await check(
      await fetch(`${BASE}/auctions/${auctionId}/live/sale`, { method: "POST" }),
    );
    return r.json();
  },
};
