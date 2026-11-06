import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, apiRequest, setSessionCsrf, subscribeUnauthorized } from "./api";
import { REQUEST_BODY_BUDGET_BYTES, SINGLE_FILE_LIMIT_BYTES } from "./limits";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => Response.json({}));
  setSessionCsrf("csrf-a");
});
afterEach(() => vi.unstubAllGlobals());

describe("credentialed transport", () => {
  it("credentials every request and adds current CSRF only to unsafe methods", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PATCH", "DELETE"]) {
      await apiRequest("/test", { method, headers: { Accept: "application/json" }, credentials: "omit" });
      const init = fetchMock.mock.calls.at(-1)![1]!;
      expect(init.credentials).toBe("include");
      const headers = new Headers(init.headers);
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("X-CSRF-Token")).toBe(["GET", "HEAD", "OPTIONS"].includes(method) ? null : "csrf-a");
    }
  });

  it("credentials domain reads, mutations and multipart without setting its content type", async () => {
    await api.candidates();
    await api.renameAuction("auction", "new");
    await api.removeEntry("list", "candidate");
    await api.createCandidate("name", new File(["image"], "test.png"));
    for (const [, init] of fetchMock.mock.calls) expect(init?.credentials).toBe("include");
    const multipart = fetchMock.mock.calls.at(-1)![1]!;
    expect(multipart.body).toBeInstanceOf(FormData);
    expect(new Headers(multipart.headers).get("Content-Type")).toBeNull();
    expect(new Headers(multipart.headers).get("X-CSRF-Token")).toBe("csrf-a");
  });

  it("routes every domain operation through the same credentialed transport", async () => {
    const file = new File(["image"], "test.png");
    const fields = { name: "field", geography: "land", history: "past" };
    const operations = [
      () => api.candidates(), () => api.getCandidate("c"),
      () => api.createCandidate("name", file), () => api.editCatalogCandidate("c", "name", null), () => api.archiveCandidate("c"),
      () => api.lists(), () => api.createList("name", true), () => api.getList("l"), () => api.editList("l", "name"),
      () => api.addEntry("l", "c"), () => api.removeEntry("l", "c"), () => api.reorder("l", "c", 0),
      () => api.archiveList("l"), () => api.cloneList("l"), () => api.editListEntry("l", "c", "name", null),
      () => api.auctions(), () => api.createAuction("name", "l"), () => api.cloneAuction("a", "name"), () => api.getAuction("a"),
      () => api.renameAuction("a", "name"), () => api.saveSimulationPromptTemplate("a", "template"), () => api.saveGeneralInfo("a", "name", "template"),
      () => api.deleteAuction("a"), () => api.startAuction("a"), () => api.addAuctionEntry("a", "c"),
      () => api.removeAuctionEntry("a", "c"), () => api.reorderAuction("a", "c", 0), () => api.editAuctionEntry("a", "c", "name", null),
      () => api.battlefields(), () => api.getBattlefield("b"), () => api.createBattlefield(fields, file), () => api.editBattlefield("b", fields, null),
      () => api.archiveBattlefield("b"), () => api.getDraftBattlefield("a"), () => api.saveDraftBattlefield("a", fields, null),
      () => api.setAuctionBattlefield("a", "b"), () => api.saveAuctionBackground("a", file), () => api.deleteAuctionBackground("a"),
      () => api.uploadTeamImage("a", file), () => api.getAuctionTeams("a"), () => api.saveAuctionTeams("a", []),
      () => api.getLive("a"), () => api.sendNextCandidate("a"), () => api.confirmBid("a", 0, [1]),
      () => api.passCandidate("a"), () => api.completeSale("a"), () => api.endAuction("a"), () => api.undoLiveAction("a"),
    ];
    for (const operation of operations) {
      const before = fetchMock.mock.calls.length;
      await operation();
      expect(fetchMock.mock.calls.length).toBe(before + 1);
      const init = fetchMock.mock.calls.at(-1)![1]!;
      expect(init.credentials).toBe("include");
      expect(new Headers(init.headers).get("X-CSRF-Token")).toBe(init.method ? "csrf-a" : null);
      if (init.body instanceof FormData) expect(new Headers(init.headers).has("Content-Type")).toBe(false);
    }
  });

  it("rejects oversized file and team JSON bodies before fetching", async () => {
    const file = new File([new Uint8Array(SINGLE_FILE_LIMIT_BYTES + 1)], "large.png");
    await expect(api.createCandidate("name", file)).rejects.toMatchObject({ status: 413, message: "image too large" });
    await expect(api.saveAuctionTeams("auction", [{
      name: "x".repeat(REQUEST_BODY_BUDGET_BYTES), slogan: "", position: 0, flag: null, members: [],
    }])).rejects.toMatchObject({ status: 413, message: "payload too large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notifies current 401s and supports unsubscribe, preserving checked errors", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Authentication required" }, { status: 401 }));
    await expect(api.candidates()).rejects.toMatchObject({ status: 401, message: "Authentication required" });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    await expect(api.candidates()).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([200, 401])("rejects obsolete %s responses without notifying the next session", async status => {
    let complete!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    const request = api.candidates();
    setSessionCsrf("csrf-b");
    complete(Response.json([], { status }));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("rechecks the session after reading a delayed error body", async () => {
    let finish!: () => void;
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const response = Response.json({ error: "old session" }, { status: 401 });
    const clone = response.clone();
    vi.spyOn(response, "clone").mockReturnValue(clone);
    vi.spyOn(clone, "json").mockImplementation(async () => {
      reading();
      await new Promise<void>(resolve => { finish = resolve; });
      return { error: "old session" };
    });
    fetchMock.mockResolvedValueOnce(response);
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    const request = api.candidates();
    await started;
    setSessionCsrf("next-session");
    finish();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps CSRF only in memory", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    setSessionCsrf("secret");
    await api.archiveCandidate("candidate");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("preserves the friendly platform 413 error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>too large</html>", { status: 413 }));
    await expect(api.candidates()).rejects.toMatchObject({ status: 413, message: "payload too large" });
  });

  it("omits default public filters and explicitly opts in", async () => {
    for (const read of [api.candidates, api.lists, api.battlefields]) {
      await read();
      expect(fetchMock.mock.calls.at(-1)![0]).not.toContain("includePublic");
      await read(false);
      expect(fetchMock.mock.calls.at(-1)![0]).not.toContain("includePublic");
      await read(true);
      expect(fetchMock.mock.calls.at(-1)![0]).toMatch(/\?includePublic=true$/);
    }
  });

  it("encodes candidate contexts and retains revision cache busting without credentials in URLs", async () => {
    await api.getCandidate("id /", { listId: "list /?&" });
    const url = new URL(String(fetchMock.mock.calls.at(-1)![0]));
    expect(url.pathname).toBe("/candidates/id%20%2F");
    expect(url.searchParams.get("listId")).toBe("list /?&");
    api.bumpCandidateImage("id /");
    const image = new URL(api.imageUrl("id /", { auctionId: "auction /?&" }));
    expect(image.searchParams.get("auctionId")).toBe("auction /?&");
    expect(image.searchParams.get("r")).toBe("1");
    expect([...image.searchParams.keys()].sort()).toEqual(["auctionId", "r"]);
    expect(new URL(api.imageUrl("candidate", { listId: "list /?&" })).searchParams.get("listId")).toBe("list /?&");
    await api.getCandidate("candidate", { auctionId: "auction /?&" });
    expect(new URL(String(fetchMock.mock.calls.at(-1)![0])).searchParams.get("auctionId")).toBe("auction /?&");
  });

  it("sends sharing only when specified on edits, private on creation, and source context on selection", async () => {
    await api.editList("list", undefined, true);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toEqual({ isPublic: true });
    await api.createList("list", false);
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toEqual({ name: "list", isDraft: false, isPublic: false });
    await api.addEntry("list", "candidate", "public-list");
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toEqual({ candidateId: "candidate", sourceListId: "public-list" });
    await api.addAuctionEntry("auction", "candidate", "public-list");
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]!.body))).toEqual({ candidateId: "candidate", sourceListId: "public-list" });
  });

  it("creates private multipart roots and preserves sharing on omitted edits", async () => {
    const file = new File(["image"], "test.png");
    const fields = { name: "name", geography: "land", history: "past" };
    for (const create of [() => api.createCandidate("name", file), () => api.createBattlefield(fields, file)]) {
      await create();
      expect((fetchMock.mock.calls.at(-1)![1]!.body as FormData).get("isPublic")).toBe("false");
    }
    for (const isPublic of [undefined, true, false]) {
      await api.editCatalogCandidate("c", "name", null, isPublic);
      expect((fetchMock.mock.calls.at(-1)![1]!.body as FormData).get("isPublic")).toBe(isPublic === undefined ? null : String(isPublic));
      await api.editBattlefield("b", fields, null, isPublic);
      expect((fetchMock.mock.calls.at(-1)![1]!.body as FormData).get("isPublic")).toBe(isPublic === undefined ? null : String(isPublic));
    }
  });
});

describe("auth API contract", () => {
  it("returns exact session/login views without automatically installing stale credentials", async () => {
    const { authApi } = await import("./auth-api");
    const view = { user: { id: "user", username: "name", email: "user@example.test" }, csrfToken: "next", googleEnabled: true, mailEnabled: false };
    fetchMock.mockResolvedValueOnce(Response.json(view)).mockResolvedValueOnce(Response.json(view));
    expect(await authApi.session()).toEqual(view);
    expect(await authApi.login("name", " password unchanged ")).toEqual(view);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/session$/);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]!.body))).toEqual({ login: "name", password: " password unchanged " });
    expect(new Headers(fetchMock.mock.calls[1][1]!.headers).get("X-CSRF-Token")).toBe("csrf-a");
  });

  it("matches account endpoints and handles 204 without JSON parsing", async () => {
    const { authApi } = await import("./auth-api");
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    await authApi.logout();
    await authApi.reauthenticate("password");
    await authApi.verifyEmail("token");
    await authApi.resetPassword("token", "password");
    await authApi.register({ username: "name", email: "user@example.test", password: "password" });
    await authApi.forgotPassword("user@example.test");
    await authApi.resendVerification("user@example.test");
    expect(fetchMock.mock.calls.map(([url]) => String(url).split("/auth/")[1])).toEqual([
      "logout", "reauthenticate", "verify-email", "reset-password", "register", "forgot-password", "resend-verification",
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === "include")).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init!.body)))).toEqual([
      {}, { password: "password" }, { token: "token" }, { token: "token", password: "password" },
      { username: "name", email: "user@example.test", password: "password" },
      { email: "user@example.test" }, { email: "user@example.test" },
    ]);
  });

  it.each([400, 403, 409, 429, 503])("preserves actionable auth error status %s", async status => {
    const { authApi } = await import("./auth-api");
    fetchMock.mockResolvedValueOnce(Response.json({ error: "retry later" }, { status }));
    await expect(authApi.login("user", "password")).rejects.toMatchObject({ status, message: "retry later" });
  });

  it("uses GET navigation for Google start and checked POST for explicit linking", async () => {
    const { authApi } = await import("./auth-api");
    const returnTo = "/auctions/a?tab=x#details";
    const url = new URL(authApi.googleStartUrl(returnTo));
    expect(url.pathname).toBe("/auth/google/start");
    expect(url.searchParams.get("returnTo")).toBe(returnTo);
    fetchMock.mockResolvedValueOnce(Response.json({ url: "https://accounts.google.com/example" }));
    expect(await authApi.linkGoogle(returnTo)).toEqual({ url: "https://accounts.google.com/example" });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/google\/link$/);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ returnTo });
  });
});
