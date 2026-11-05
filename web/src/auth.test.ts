import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountScreen, SessionOwner, accountRoute, captureAccountToken, postLoginDestination, safeDestination } from "./auth";
import { apiRequest, setSessionCsrf } from "./api-transport";
import type { SessionView } from "./auth-api";

const view = (id: string | null): SessionView => ({ user: id ? { id, username: id, email: `${id}@example.test` } : null, csrfToken: "test-csrf", googleEnabled: false, mailEnabled: false });
afterEach(() => { vi.unstubAllGlobals(); setSessionCsrf(""); });
describe("account routes", () => {
  it("accepts only known workspace destinations including legacy tabs", () => {
    expect(safeDestination("?tab=live")).toBe("/app?tab=live");
    expect(safeDestination("/app?tab=catalog")).toBe("/app?tab=catalog");
    for (const path of ["//evil.test", "https://evil.test", "/app/../account", "/app?tab=unknown", "/app?tab=live&token=secret"]) expect(safeDestination(path)).toBe("/app");
    expect(accountRoute(new URL("https://example.test/account/reset-password#token=x"))).toBe("reset");
    expect(accountRoute(new URL("https://example.test/account?mode=forgot"))).toBe("forgot");
  });
  it("captures and strips fragments immediately and never takes tokens from queries", () => {
    const replaceState = vi.fn();
    expect(captureAccountToken(new URL("https://example.test/account/reset-password#token=one-time"), { replaceState })).toBe("one-time");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/account/reset-password");
    expect(captureAccountToken(new URL("https://example.test/account?token=wrong"), { replaceState })).toBe("");
  });
  it("preserves direct and legacy tab destinations for native Google navigation too", () => {
    expect(postLoginDestination(new URL("https://example.test/?tab=live"))).toBe("/app?tab=live");
    expect(postLoginDestination(new URL("https://example.test/app?tab=catalog"))).toBe("/app?tab=catalog");
    expect(postLoginDestination(new URL("https://example.test/account?returnTo=%2Fapp%3Ftab%3Ddraft"))).toBe("/app?tab=draft");
  });
  it("renders labeled reset form and explicit unavailable capabilities", () => {
    const html = renderToStaticMarkup(createElement(AccountScreen, { owner: new SessionOwner(), mode: "reset", token: "", lang: "en", onMode: () => {} }));
    expect(html).toContain("expired");
    expect(html).not.toContain('name="password"');
    const login = renderToStaticMarkup(createElement(AccountScreen, { owner: new SessionOwner(), mode: "login", token: "", lang: "en", onMode: () => {} }));
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain("Google sign-in is unavailable");
  });
});
describe("session ownership", () => {
  it("gates workspace until bootstrap and clears it synchronously on expiry", async () => {
    const owner = new SessionOwner();
    expect(owner.snapshot().view?.user).toBeUndefined();
    await owner.run(async () => view("alice"));
    expect(owner.snapshot().view?.user?.id).toBe("alice");
    owner.expire();
    expect(owner.snapshot().view?.user).toBeUndefined();
    await owner.run(async () => view(null));
    expect(owner.snapshot().expired).toBe(true);
  });
  it("ignores complete delayed login JSON after invalidation", async () => {
    const owner = new SessionOwner();
    let resolve!: (value: SessionView) => void;
    let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    const pending = owner.run(() => new Promise<SessionView>(r => { resolve = r; started(); }));
    await ready;
    owner.expire();
    resolve(view("alice"));
    await pending;
    expect(owner.snapshot().view?.user).toBeUndefined();
    await owner.run(async () => view("bob"));
    expect(owner.snapshot().view?.user?.id).toBe("bob");
  });
  it("logout failure stays fail closed", async () => {
    const owner = new SessionOwner();
    await owner.run(async () => view("alice"));
    const pending = owner.logout(async () => { throw new Error("offline"); });
    expect(owner.snapshot().view?.user).toBeUndefined();
    await expect(pending).rejects.toThrow("offline");
    expect(owner.snapshot().view?.user).toBeUndefined();
    expect(owner.snapshot().blocked).toBe(true);
  });
  it("serializes session work and boots anonymous CSRF after successful logout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(view(null))));
    const owner = new SessionOwner();
    await owner.run(async () => view("alice"));
    await owner.logout(async () => {});
    expect(owner.snapshot().view?.user).toBeNull();
    expect(owner.snapshot().busy).toBe(false);
    expect(owner.snapshot().blocked).toBe(false);
  });
  it("rejects already returned old-user domain JSON after user switch", async () => {
    let resolve!: (value: unknown) => void;
    const response = new Response();
    response.json = () => new Promise(r => { resolve = r; });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    setSessionCsrf("alice");
    const old = await apiRequest("/candidates");
    const decoded = old.json();
    setSessionCsrf("bob");
    resolve([{ name: "Alice private candidate" }]);
    await expect(decoded).rejects.toMatchObject({ name: "AbortError" });
  });
});
