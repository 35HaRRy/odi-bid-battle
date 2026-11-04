import { isFileTooLarge, isJsonTooLarge } from "./limits";
import { API_BASE as BASE, ApiError, apiRequest } from "./api-transport";
export { ApiError, apiRequest, setSessionCsrf, subscribeUnauthorized } from "./api-transport";

function assertFileBudget(file: File | null | undefined): void {
  if (isFileTooLarge(file)) {
    throw new ApiError(413, "image too large", null);
  }
}

function assertJsonBudget(value: unknown): void {
  if (isJsonTooLarge(value)) {
    throw new ApiError(413, "payload too large", null);
  }
}

export interface Visibility {
  ownerUserId: string;
  isOwner: boolean;
  isPublic: boolean;
}
export type CandidateContext = { listId: string; auctionId?: never } | { auctionId: string; listId?: never };

export interface Candidate extends Visibility {
  id: string;
  name: string;
}
export interface CandidateList extends Visibility {
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
  simulationPromptTemplate: string;
  status: string;
}
export interface BattlefieldSummary extends Visibility {
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
export interface TeamImageRef {
  mime: string;
  name: string;
  size: number;
  url: string;
}
export interface TeamImageUploadRef {
  uploadId: string;
}
export interface TeamFlagReuseRef {
  teamId: string;
}
export interface TeamAvatarReuseRef {
  memberId: string;
}
// Legacy inline payloads are still accepted by the server so older saves
// keep working; new saves use upload/reuse references instead of base64.
export interface TeamImagePayload {
  data: string;
  mime: string;
  name: string;
}
export type TeamFlagPayload = TeamImageUploadRef | TeamFlagReuseRef | TeamImagePayload | null;
export type TeamAvatarPayload = TeamImageUploadRef | TeamAvatarReuseRef | TeamImagePayload | null;
export interface TeamMemberPayload {
  name: string;
  initialGold: number;
  avatar: TeamAvatarPayload;
}
export interface TeamPayload {
  name: string;
  slogan: string;
  position: 0 | 1;
  flag: TeamFlagPayload;
  members: TeamMemberPayload[];
}
export interface SavedTeamMember {
  id: string;
  teamId: string;
  name: string;
  initialGold: number;
  avatar: TeamImageRef | null;
}
export interface SavedTeam {
  id: string;
  auctionId: string;
  name: string;
  slogan: string | null;
  position: 0 | 1;
  flag: TeamImageRef;
  members: SavedTeamMember[];
}
export interface TeamImageUpload {
  uploadId: string;
  mime: string;
  name: string;
  size: number;
  url: string;
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
export interface LiveBattlefield {
  id: string;
  name: string;
  geography: string;
  history: string;
}
export interface LiveState {
  auctionId: string;
  status: "ongoing" | "completed";
  cursor: number;
  active: boolean;
  activeCandidateId: string | null;
  turn: 0 | 1;
  specialPass: boolean;
  latest: { team: 0 | 1; amount: number; contributions: number[] } | null;
  contributions: number[][];
  skipped: string[];
  capacity: number;
  readyToEnd: boolean;
  canUndo: boolean;
  battlefield: LiveBattlefield | null;
  battlefieldVisible: boolean;
  teams: LiveTeam[];
}

function editForm(name: string, file: File | null, isPublic?: boolean): FormData {
  const fd = new FormData();
  fd.append("name", name);
  if (file) fd.append("image", file);
  if (isPublic !== undefined) fd.append("isPublic", String(isPublic));
  return fd;
}

// In-place catalog edits keep the same candidate id with new image bytes,
// so the image URL must change to bust the browser cache in mounted lists.
const candidateImageRevs: Record<string, number> = {};

function candidatePath(id: string, image: boolean, context?: CandidateContext): string {
  const params = new URLSearchParams();
  if (context?.listId !== undefined) params.set("listId", context.listId);
  if (context?.auctionId !== undefined) params.set("auctionId", context.auctionId);
  if (image && candidateImageRevs[id]) params.set("r", String(candidateImageRevs[id]));
  const query = params.toString();
  return `/candidates/${encodeURIComponent(id)}${image ? "/image" : ""}${query ? `?${query}` : ""}`;
}

export const api = {
  base: BASE,
  imageUrl: (id: string, context?: CandidateContext) => `${BASE}${candidatePath(id, true, context)}`,
  bumpCandidateImage: (id: string) => {
    candidateImageRevs[id] = (candidateImageRevs[id] ?? 0) + 1;
  },
  battlefieldImageUrl: (id: string) => `${BASE}/battlefields/${id}/image`,
  draftBattlefieldImageUrl: (auctionId: string, rev = 0) =>
    `${BASE}/auctions/${auctionId}/battlefield/image${rev ? `?r=${rev}` : ""}`,
  auctionBackgroundUrl: (id: string, rev = 0) =>
    `${BASE}/auctions/${id}/background${rev ? `?r=${rev}` : ""}`,
  async candidates(includePublic = false): Promise<Candidate[]> {
    const r = await apiRequest(`/candidates${includePublic === true ? "?includePublic=true" : ""}`);
    return r.json();
  },
  async getCandidate(id: string, context?: CandidateContext): Promise<Candidate> {
    const r = await apiRequest(candidatePath(id, false, context));
    return r.json();
  },
  async editCatalogCandidate(
    id: string,
    name: string,
    file: File | null,
    isPublic?: boolean,
  ): Promise<Candidate> {
    assertFileBudget(file);
    const r = await apiRequest(`/candidates/${id}/edit`, {
      method: "POST",
      body: editForm(name, file, isPublic),
    });
    return r.json();
  },
  async createCandidate(name: string, file: File, isPublic = false): Promise<Candidate> {
    assertFileBudget(file);
    const fd = new FormData();
    fd.append("name", name);
    fd.append("image", file);
    fd.append("isPublic", String(isPublic));
    const r = await apiRequest("/candidates", { method: "POST", body: fd });
    return r.json();
  },
  async archiveCandidate(id: string): Promise<void> {
    await apiRequest(`/candidates/${id}/archive`, { method: "POST" });
  },
  async lists(includePublic = false): Promise<CandidateList[]> {
    const r = await apiRequest(`/lists${includePublic === true ? "?includePublic=true" : ""}`);
    return r.json();
  },
  async createList(name: string, isDraft: boolean, isPublic = false): Promise<CandidateList> {
    const r = await apiRequest("/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, isDraft, isPublic }),
    });
    return r.json();
  },
  async getList(id: string): Promise<CandidateList> {
    const r = await apiRequest(`/lists/${id}`);
    return r.json();
  },
  async editList(id: string, name?: string, isPublic?: boolean): Promise<CandidateList> {
    const r = await apiRequest(`/lists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, isPublic }),
    });
    return r.json();
  },
  async addEntry(listId: string, candidateId: string, sourceListId?: string): Promise<CandidateList> {
    const r = await apiRequest(`/lists/${listId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, sourceListId }),
    });
    return r.json();
  },
  async removeEntry(
    listId: string,
    candidateId: string,
  ): Promise<CandidateList> {
    const r = await apiRequest(`/lists/${listId}/entries/${candidateId}`, {
      method: "DELETE",
    });
    return r.json();
  },
  async reorder(
    listId: string,
    candidateId: string,
    toIndex: number,
  ): Promise<CandidateList> {
    const r = await apiRequest(`/lists/${listId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, toIndex }),
    });
    return r.json();
  },
  async archiveList(id: string): Promise<void> {
    await apiRequest(`/lists/${id}/archive`, { method: "POST" });
  },
  async cloneList(id: string): Promise<CandidateList> {
    const r = await apiRequest(`/lists/${id}/clone`, { method: "POST" });
    return r.json();
  },
  async editListEntry(
    listId: string,
    candidateId: string,
    name: string,
    file: File | null,
  ): Promise<{ candidate: Candidate; list: CandidateList }> {
    assertFileBudget(file);
    const r = await apiRequest(`/lists/${listId}/entries/${candidateId}/edit`, {
      method: "POST",
      body: editForm(name, file),
    });
    return r.json();
  },
  async auctions(): Promise<Auction[]> {
    const r = await apiRequest("/auctions");
    return r.json();
  },
  async createAuction(
    name: string,
    sourceListId: string | null,
    simulationPromptTemplate = "",
  ): Promise<Auction> {
    const r = await apiRequest("/auctions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, sourceListId, simulationPromptTemplate }),
    });
    return r.json();
  },
  async cloneAuction(id: string, name: string): Promise<Auction> {
    const r = await apiRequest(`/auctions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return r.json();
  },
  async getAuction(id: string): Promise<Auction> {
    const r = await apiRequest(`/auctions/${id}`);
    return r.json();
  },
  async renameAuction(id: string, name: string): Promise<Auction> {
    const r = await apiRequest(`/auctions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return r.json();
  },
  async saveSimulationPromptTemplate(id: string, template: string): Promise<Auction> {
    const r = await apiRequest(`/auctions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simulationPromptTemplate: template }),
    });
    return r.json();
  },
  async saveGeneralInfo(id: string, name: string, template: string): Promise<Auction> {
    const r = await apiRequest(`/auctions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, simulationPromptTemplate: template }),
    });
    return r.json();
  },
  async deleteAuction(id: string): Promise<void> {
    await apiRequest(`/auctions/${id}`, { method: "DELETE" });
  },
  async startAuction(id: string): Promise<Auction> {
    const r = await apiRequest(`/auctions/${id}/start`, { method: "POST" });
    return r.json();
  },
  async addAuctionEntry(
    auctionId: string,
    candidateId: string,
    sourceListId?: string,
  ): Promise<Auction> {
    const r = await apiRequest(`/auctions/${auctionId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, sourceListId }),
    });
    return r.json();
  },
  async removeAuctionEntry(
    auctionId: string,
    candidateId: string,
  ): Promise<Auction> {
    const r = await apiRequest(`/auctions/${auctionId}/entries/${candidateId}`, {
      method: "DELETE",
    });
    return r.json();
  },
  async reorderAuction(
    auctionId: string,
    candidateId: string,
    toIndex: number,
  ): Promise<Auction> {
    const r = await apiRequest(`/auctions/${auctionId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, toIndex }),
    });
    return r.json();
  },
  async editAuctionEntry(
    auctionId: string,
    candidateId: string,
    name: string,
    file: File | null,
  ): Promise<{ candidate: Candidate; auction: Auction }> {
    assertFileBudget(file);
    const r = await apiRequest(
      `/auctions/${auctionId}/entries/${candidateId}/edit`,
      { method: "POST", body: editForm(name, file) },
    );
    return r.json();
  },
  async battlefields(includePublic = false): Promise<BattlefieldSummary[]> {
    const r = await apiRequest(`/battlefields${includePublic === true ? "?includePublic=true" : ""}`);
    return r.json();
  },
  async getBattlefield(id: string): Promise<BattlefieldSummary> {
    const r = await apiRequest(`/battlefields/${id}`);
    return r.json();
  },
  async createBattlefield(
    fields: { name: string; geography: string; history: string },
    file: File,
    isPublic = false,
  ): Promise<BattlefieldSummary> {
    assertFileBudget(file);
    const fd = new FormData();
    fd.append("name", fields.name);
    fd.append("geography", fields.geography);
    fd.append("history", fields.history);
    fd.append("image", file);
    fd.append("isPublic", String(isPublic));
    const r = await apiRequest("/battlefields", { method: "POST", body: fd });
    return r.json();
  },
  async editBattlefield(
    id: string,
    fields: { name: string; geography: string; history: string },
    file: File | null,
    isPublic?: boolean,
  ): Promise<BattlefieldSummary> {
    assertFileBudget(file);
    const fd = new FormData();
    fd.append("name", fields.name);
    fd.append("geography", fields.geography);
    fd.append("history", fields.history);
    if (file) fd.append("image", file);
    if (isPublic !== undefined) fd.append("isPublic", String(isPublic));
    const r = await apiRequest(`/battlefields/${id}/edit`, {
      method: "POST",
      body: fd,
    });
    return r.json();
  },
  async archiveBattlefield(id: string): Promise<void> {
    await apiRequest(`/battlefields/${id}/archive`, { method: "POST" });
  },
  async getDraftBattlefield(auctionId: string): Promise<DraftBattlefield> {
    const r = await apiRequest(`/auctions/${auctionId}/battlefield`);
    return r.json();
  },
  async saveDraftBattlefield(
    auctionId: string,
    fields: { geography: string; history: string },
    file: File | null,
  ): Promise<DraftBattlefield> {
    assertFileBudget(file);
    const fd = new FormData();
    fd.append("geography", fields.geography);
    fd.append("history", fields.history);
    if (file) fd.append("image", file);
    const r = await apiRequest(`/auctions/${auctionId}/battlefield`, {
      method: "POST",
      body: fd,
    });
    return r.json();
  },
  async setAuctionBattlefield(
    auctionId: string,
    battlefieldId: string | null,
  ): Promise<Auction> {
    const r = await apiRequest(`/auctions/${auctionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ battlefieldId }),
    });
    return r.json();
  },
  async saveAuctionBackground(auctionId: string, file: File): Promise<void> {
    assertFileBudget(file);
    const fd = new FormData();
    fd.append("image", file);
    await apiRequest(`/auctions/${auctionId}/background`, {
      method: "POST",
      body: fd,
    });
  },
  async deleteAuctionBackground(auctionId: string): Promise<void> {
    await apiRequest(`/auctions/${auctionId}/background`, {
      method: "DELETE",
    });
  },
  teamFlagUrl: (auctionId: string, teamId: string) =>
    `${BASE}/auctions/${auctionId}/teams/${teamId}/flag`,
  teamAvatarUrl: (auctionId: string, teamId: string, memberId: string) =>
    `${BASE}/auctions/${auctionId}/teams/${teamId}/members/${memberId}/avatar`,
  teamImageUrl: (ref: TeamImageRef) => `${BASE}${ref.url}`,
  async uploadTeamImage(auctionId: string, file: File): Promise<TeamImageUpload> {
    assertFileBudget(file);
    const fd = new FormData();
    fd.append("image", file);
    const r = await apiRequest(`/auctions/${auctionId}/team-images`, { method: "POST", body: fd });
    return r.json();
  },
  async getAuctionTeams(auctionId: string): Promise<SavedTeam[]> {
    const r = await apiRequest(`/auctions/${auctionId}/teams`);
    return r.json();
  },
  async saveAuctionTeams(auctionId: string, teams: TeamPayload[]): Promise<SavedTeam[]> {
    assertJsonBudget({ teams });
    const r = await apiRequest(`/auctions/${auctionId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teams }),
    });
    return r.json();
  },
  async getLive(auctionId: string): Promise<LiveState> {
    const r = await apiRequest(`/auctions/${auctionId}/live`);
    return r.json();
  },
  async sendNextCandidate(auctionId: string): Promise<LiveState> {
    const r = await apiRequest(`/auctions/${auctionId}/live/next`, { method: "POST" });
    return r.json();
  },
  async confirmBid(
    auctionId: string,
    team: 0 | 1,
    contributions: number[],
    drafts?: number[][],
  ): Promise<LiveState> {
    const r = await apiRequest(`/auctions/${auctionId}/live/bids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team, contributions, drafts }),
    });
    return r.json();
  },
  async passCandidate(
    auctionId: string,
    drafts?: number[][],
  ): Promise<LiveState> {
    const r = await apiRequest(`/auctions/${auctionId}/live/pass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drafts }),
    });
    return r.json();
  },
  async completeSale(
    auctionId: string,
    drafts?: number[][],
  ): Promise<LiveState> {
    const r = await apiRequest(`/auctions/${auctionId}/live/sale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drafts }),
    });
    return r.json();
  },
  async endAuction(auctionId: string): Promise<LiveState> {
    const r = await apiRequest(`/auctions/${auctionId}/live/end`, { method: "POST" });
    return r.json();
  },
  async undoLiveAction(auctionId: string): Promise<LiveState> {
    const r = await apiRequest(`/auctions/${auctionId}/live/undo`, { method: "POST" });
    return r.json();
  },
};
