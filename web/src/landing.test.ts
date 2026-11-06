import { afterEach, expect, it, vi } from "vitest";
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { LandingPage, observeLanding } from "./landing";
import { AccountScreen, SessionBoundary, SessionOwner } from "./auth";
import { setSessionCsrf } from "./api-transport";

const hooks = vi.hoisted(() => ({ values: null as unknown[] | null, cursor: 0 }));
vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  return { ...react,
    useState: (initial: unknown) => {
      if (!hooks.values) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
      return [hooks.values[index], (value: unknown) => { hooks.values![index] = value; }];
    },
    useEffect: (...args: Parameters<typeof react.useEffect>) => hooks.values ? undefined : react.useEffect(...args),
    useSyncExternalStore: (...args: Parameters<typeof react.useSyncExternalStore>) => hooks.values ? args[1]() : react.useSyncExternalStore(...args),
  };
});
afterEach(() => { hooks.values = null; hooks.cursor = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); setSessionCsrf(""); });
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as ReactNode)] : []);
}

it.each(["landing", "account", "loading", "workspace", "blocked"])("keeps one shared branded header and footer on %s", async page => {
  const owner = new SessionOwner();
  if (page !== "loading") await owner.run(async () => ({ user: page === "workspace" || page === "blocked" ? { id: "demo", username: "demo", email: "demo@example.test" } : null, csrfToken: "synthetic", googleEnabled: true, mailEnabled: true }));
  if (page === "blocked") await owner.logout(async () => { throw new Error("offline"); }).catch(() => {});
  const url = new URL(`https://example.test${page === "landing" ? "/" : page === "account" ? "/account?mode=register" : "/app"}`);
  vi.stubGlobal("window", { location: { href: url.href } });
  hooks.values = [owner, "tr", url, "", page !== "loading", false];
  const html = renderToStaticMarkup(SessionBoundary({ children: () => createElement("main", null, "WORKSPACE") }));
  expect(html.match(/<header\b/g) ?? []).toHaveLength(1);
  expect(html.match(/<footer\b/g) ?? []).toHaveLength(1);
  expect(html).toContain('class="site-header"');
  expect(html).toContain('class="site-footer"');
  expect(html).toContain('src="/logo.jpg"');
  expect(html).toContain('aria-label="English"');
  expect(html.includes('class="account-menu"')).toBe(page === "workspace");
  const links = [...html.matchAll(/href="(https:\/\/[^\"]+)"/g)].map(match => match[1]);
  expect(links).toEqual([
    "https://hayrihabip.com/", "https://github.com/35HaRRy/odibb",
    "https://www.linkedin.com/in/hayri-habip/", "https://x.com/35_HaRRy",
    "https://www.instagram.com/hayrihabip/",
  ]);
  for (const name of ["Web sitesi", "GitHub", "LinkedIn", "X", "Instagram"]) expect(html).toContain(`aria-label="${name}"`);
});

it.each(["tr", "en"] as const)("renders the four-stage public story and accessible CTA in %s without requests", lang => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const html = renderToStaticMarkup(createElement(LandingPage, { lang, onStart() {} }));
  expect(html).toContain(lang === "tr" ? "Adaylarını seç" : "Choose your candidates");
  expect(html).toContain(lang === "tr" ? "Sonucu göster" : "Show the result");
  expect(html).toMatch(/<button[^>]*>[^<]+<\/button>/);
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  expect(images.length).toBeGreaterThan(0); expect(images.length).toBeLessThanOrEqual(3);
  for (const image of images) {
    expect(image).toContain('loading="lazy"');
    expect(image).toMatch(/width="\d+"/); expect(image).toMatch(/height="\d+"/);
    expect(image).toMatch(/alt="[^"]+"/);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it.each([null, "demo"])("never mounts protected children at the public root (session %s)", async id => {
  const owner = new SessionOwner();
  await owner.run(async () => ({ user: id ? { id, username: id, email: "demo@example.test" } : null, csrfToken: "synthetic", googleEnabled: false, mailEnabled: false }));
  const pushState = vi.fn();
  vi.stubGlobal("window", { location: { href: "https://example.test/", origin: "https://example.test" }, history: { pushState } });
  hooks.values = [owner, "en", new URL("https://example.test/"), "", true, false];
  const children = vi.fn(() => createElement("div", null, "PRIVATE WORKSPACE"));
  const tree = SessionBoundary({ children });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("Choose your candidates");
  expect(html).not.toContain("PRIVATE WORKSPACE"); expect(children).not.toHaveBeenCalled();
  // Invoke the actual boundary-supplied CTA, not a duplicate routing helper.
  const landing = elements(tree).find(element => element.type === LandingPage)!;
  (landing.props.onStart as () => void)();
  expect(pushState.mock.calls[0][2].pathname).toBe(id ? "/app" : "/account");
});

it.each(["/?tab=live", "/app", "/account", "/account/reset-password"])("does not turn protected/legacy/account routes into landing: %s", async path => {
  const owner = new SessionOwner();
  await owner.run(async () => ({ user: null, csrfToken: "synthetic", googleEnabled: false, mailEnabled: false }));
  vi.stubGlobal("window", { location: { href: `https://example.test${path}` } });
  hooks.values = [owner, "en", new URL(`https://example.test${path}`), "", true, false];
  const children = vi.fn(() => createElement("p", null, "PRIVATE WORKSPACE"));
  const html = renderToStaticMarkup(SessionBoundary({ children }));
  expect(html).not.toContain("landing-page"); expect(html).toContain("account-shell");
  expect(children).not.toHaveBeenCalled();
});

it("serves the public story even before session bootstrap completes", () => {
  vi.stubGlobal("window", { location: { href: "https://example.test/" } });
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const html = renderToStaticMarkup(createElement(SessionBoundary, { children: () => { throw new Error("private mount"); } }));
  expect(html).toContain("landing-page"); expect(fetch).not.toHaveBeenCalled();
});

it.each(["unavailable", "busy", "blocked"])("landing CTA cannot enter private workspace while %s", async mode => {
  const owner = new SessionOwner();
  const view = { user: { id: "demo", username: "demo", email: "demo@example.test" }, csrfToken: "synthetic", googleEnabled: false, mailEnabled: false };
  await owner.run(async () => view);
  if (mode === "unavailable") owner.expire(false);
  if (mode === "busy") void owner.run(() => new Promise(() => {}));
  if (mode === "blocked") await owner.logout(async () => { throw new Error("offline"); }).catch(() => {});
  const pushState = vi.fn();
  vi.stubGlobal("window", { location: { href: "https://example.test/", origin: "https://example.test" }, history: { pushState } });
  hooks.values = [owner, "en", new URL("https://example.test/"), "", true, mode === "unavailable"];
  const children = vi.fn();
  const landing = elements(SessionBoundary({ children })).find(el => el.type === LandingPage)!;
  (landing.props.onStart as () => void)();
  expect(pushState.mock.calls[0][2].pathname).toBe("/account");
  expect(children).not.toHaveBeenCalled();
});

it("remounts account forms on mode changes so a consumed verification/reset cannot hide the sign-in form", async () => {
  const owner = new SessionOwner();
  await owner.run(async () => ({ user: null, csrfToken: "synthetic", googleEnabled: false, mailEnabled: true }));
  const keys = [];
  for (const mode of ["verify", "reset", "login"]) {
    const url = new URL(mode === "login" ? "https://example.test/account" : `https://example.test/account/${mode === "verify" ? "verify-email" : "reset-password"}`);
    vi.stubGlobal("window", { location: { href: url.href } });
    hooks.cursor = 0;
    hooks.values = [owner, "en", url, "synthetic-token", true, false];
    const form = elements(SessionBoundary({ children: vi.fn() })).find(el => el.type === AccountScreen)!;
    keys.push(form.key);
  }
  expect(new Set(keys).size).toBe(3);
});

it("keeps the entered identifier outside keyed login/register forms", async () => {
  const owner = new SessionOwner();
  await owner.run(async () => ({ user: null, csrfToken: "synthetic", googleEnabled: false, mailEnabled: true }));
  hooks.values = [owner, "en", new URL("https://example.test/account"), "", true, false];
  vi.stubGlobal("window", { location: { href: "https://example.test/account" } });
  const render = () => { hooks.cursor = 0; return elements(SessionBoundary({ children: vi.fn() })).find(el => el.type === AccountScreen)!; };
  const login = render();
  expect(login.props.onIdentifierChange).toBeTypeOf("function");
  (login.props.onIdentifierChange as (value: string) => void)("remember@example.test");
  hooks.values[2] = new URL("https://example.test/account?mode=register");
  const register = render();
  expect(register.key).not.toBe(login.key);
  expect(register.props.identifier).toBe("remember@example.test");
  hooks.values[2] = new URL("https://example.test/account");
  expect(render().props.identifier).toBe("remember@example.test");
});

it.each(["reduced", "no-observer"])("keeps all content visible with %s", fallback => {
  vi.stubGlobal("matchMedia", () => ({ matches: fallback === "reduced" }));
  const observer = vi.fn();
  vi.stubGlobal("IntersectionObserver", fallback === "reduced" ? observer : undefined);
  const querySelectorAll = vi.fn(() => []);
  const root = { querySelectorAll } as unknown as HTMLElement;
  expect(() => observeLanding(root)()).not.toThrow();
  expect(querySelectorAll).not.toHaveBeenCalled();
  expect(observer).not.toHaveBeenCalled();
  const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toMatch(/position:\s*static/);
});

it("reveals observed cards, then removes motion and disconnects on preference change or unmount", () => {
  let reveal!: IntersectionObserverCallback;
  let change!: () => void;
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { reveal = callback; }
    observe = observe; unobserve = unobserve; disconnect = disconnect;
  });
  const removeEventListener = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: (_: string, listener: () => void) => { change = listener; }, removeEventListener }));
  const card = { classList: { add: vi.fn() } };
  const root = { querySelectorAll: () => [card], classList: { add: vi.fn(), remove: vi.fn() } };
  const cleanup = observeLanding(root as unknown as HTMLElement);
  expect(observe).toHaveBeenCalledWith(card);
  expect(root.classList.add).toHaveBeenCalledWith("landing-motion");
  reveal([{ isIntersecting: true, target: card }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
  expect(card.classList.add).toHaveBeenCalledWith("is-revealed");
  expect(unobserve).toHaveBeenCalledWith(card);
  change();
  expect(root.classList.remove).toHaveBeenCalledWith("landing-motion");
  expect(disconnect).toHaveBeenCalled();
  cleanup(); expect(removeEventListener).toHaveBeenCalledWith("change", change);
});

it("keeps API routing before account/app SPA fallbacks, including Google callbacks", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  expect(config.rewrites[0]).toEqual({ source: "/api/:path*", destination: "/api/index" });
  expect(config.rewrites).toContainEqual({ source: "/account/:path*", destination: "/index.html" });
  expect(config.rewrites).toContainEqual({ source: "/app", destination: "/index.html" });
});
