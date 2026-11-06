import { afterEach, describe, expect, it, vi } from "vitest";
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountScreen, SessionOwner, accountRoute, captureAccountToken, postLoginDestination, safeDestination } from "./auth";
import { ApiError, apiRequest, setSessionCsrf } from "./api-transport";
import type { SessionView } from "./auth-api";
import { authApi } from "./auth-api";

// Drive this component's handlers without adding a DOM/test-renderer dependency.
const hooks = vi.hoisted(() => ({ values: null as unknown[] | null, cursor: 0 }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (!hooks.values) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = initial;
      return [hooks.values[index], (value: unknown) => { hooks.values![index] = value; }];
    },
    useRef: (initial: unknown) => hooks.values ? { current: initial } : react.useRef(initial),
    useEffect: (...args: Parameters<typeof react.useEffect>) => hooks.values ? undefined : react.useEffect(...args),
    useSyncExternalStore: (...args: Parameters<typeof react.useSyncExternalStore>) => hooks.values ? args[1]() : react.useSyncExternalStore(...args),
  };
});
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as ReactNode)] : []);
}

const view = (id: string | null): SessionView => ({ user: id ? { id, username: id, email: `${id}@example.test` } : null, csrfToken: "test-csrf", googleEnabled: false, mailEnabled: false });
afterEach(() => { hooks.values = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); setSessionCsrf(""); });
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
    const html = renderToStaticMarkup(createElement(AccountScreen, { owner: new SessionOwner(), mode: "reset", token: "", lang: "en", onMode: () => {}, identifier: "", onIdentifierChange: () => {} }));
    expect(html).toContain("expired");
    expect(html).not.toContain('name="password"');
    const login = renderToStaticMarkup(createElement(AccountScreen, { owner: new SessionOwner(), mode: "login", token: "", lang: "en", onMode: () => {}, identifier: "", onIdentifierChange: () => {} }));
    expect(login).toContain('autoComplete="username"');
    expect(login).toContain("Google sign-in is unavailable");
  });
  it("uses logo branding, an official Google mark and compact icon account actions", async () => {
    const owner = new SessionOwner();
    await owner.run(async () => ({ ...view(null), googleEnabled: true, mailEnabled: true }));
    const tree = createElement(AccountScreen, { owner, mode: "register", token: "", lang: "tr", onMode: () => {}, identifier: "", onIdentifierChange: () => {} });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('src="/logo.jpg"');
    expect(html).toMatch(/class="account-google"[^>]*href="[^"]*\/auth\/google\/start\?/);
    expect(html).toContain('src="/google-g.png"');
    for (const label of ["Giriş yap", "Şifremi unuttum", "Doğrulama bağlantısını yeniden gönder"]) {
      expect(html).toMatch(new RegExp(`<button[^>]*class="[^"]*account-action[^\"]*"[^>]*><svg[^>]*aria-hidden="true"[^>]*>.*?</svg><span>${label}</span></button>`));
    }
  });
});
describe("session ownership", () => {
  it.each(["login", "register", "reset"] as const)("%s accepts 65 non-BMP password characters without native truncation and rejects 129 code points", async mode => {
    const owner = new SessionOwner();
    await owner.run(async () => ({ ...view(null), mailEnabled: true }));
    const login = vi.spyOn(authApi, "login").mockResolvedValue(view("alice"));
    const register = vi.spyOn(authApi, "register").mockResolvedValue();
    const reset = vi.spyOn(authApi, "resetPassword").mockResolvedValue();
    vi.spyOn(authApi, "session").mockResolvedValue(view(null));
    hooks.values = [];
    const render = () => { hooks.cursor = 0; return AccountScreen({ owner, mode, token: "reset-token", lang: "en", onMode: () => {}, identifier: "", onIdentifierChange: () => {} }); };
    const input = () => elements(render()).find(el => el.props.name === "password")!;
    expect(input().props.maxLength).toBeUndefined();
    const change = (value: string) => (input().props.onChange as (event: unknown) => void)({ target: { value } });
    const submit = () => (elements(render()).find(el => el.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
    change("😀".repeat(129)); await submit();
    expect(login).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
    const password = "😀".repeat(65);
    change(password); await submit();
    if (mode === "login") expect(login).toHaveBeenCalledWith("", password);
    if (mode === "register") expect(register).toHaveBeenCalledWith({ username: "", email: "", password });
    if (mode === "reset") expect(reset).toHaveBeenCalledWith("reset-token", password);
  });
  it("keeps a successful reset consumed when session refresh fails and reconnects", async () => {
    const owner = new SessionOwner();
    await owner.run(async () => view("alice"));
    const reset = vi.spyOn(authApi, "resetPassword").mockResolvedValue();
    vi.spyOn(authApi, "session").mockRejectedValue(new ApiError(503, "refresh unavailable"));
    hooks.values = [];
    const render = () => {
      hooks.cursor = 0;
      return AccountScreen({ owner, mode: "reset", token: "one-time-reset", lang: "en", onMode: () => {}, identifier: "", onIdentifierChange: () => {} });
    };
    let tree = render();
    const input = elements(tree).find(element => element.props.name === "password")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: "new-password-only" } });
    tree = render();
    const submit = elements(tree).find(element => element.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>;
    await submit({ preventDefault() {} });
    expect(owner.snapshot().view?.user).toBeUndefined();
    expect(renderToStaticMarkup(render())).toContain("Done. Sign in to continue.");
    expect(renderToStaticMarkup(render())).not.toContain("new-password-only");
    expect(renderToStaticMarkup(render())).toContain("The service is unavailable.");
    expect(elements(render()).some(element => element.type === "form")).toBe(false);
    await owner.run(async () => view(null));
    expect(elements(render()).some(element => element.props.name === "password")).toBe(false);
    expect(reset).toHaveBeenCalledTimes(1);
  });
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
