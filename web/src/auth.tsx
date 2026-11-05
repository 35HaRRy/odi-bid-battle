import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authApi, setSessionCsrf, subscribeUnauthorized, type AuthUser, type SessionView } from "./auth-api";
import { ApiError } from "./api-transport";
import { getLang, setLang, t, type Lang } from "./i18n";
import { LandingPage } from "./landing";

export type AccountMode = "login" | "register" | "forgot" | "reset" | "verify" | "link" | "reauth";
const modes: AccountMode[] = ["login", "register", "forgot", "reset", "verify", "link", "reauth"];
export function safeDestination(value: string | null): string {
  if (!value) return "/app";
  if (value.startsWith("?")) value = `/app${value}`;
  if (!/^\/app(?:\?tab=(?:auctions|catalog|lists|battlefields|draft|live|result))?$/.test(value)) return "/app";
  return value;
}
export function postLoginDestination(url: URL): string {
  if (url.pathname === "/app" || (url.pathname === "/" && url.searchParams.has("tab"))) return safeDestination(`/app${url.search}`);
  return safeDestination(url.searchParams.get("returnTo"));
}
export function accountRoute(url: URL): AccountMode {
  if (url.pathname === "/account/reset-password") return "reset";
  if (url.pathname === "/account/verify-email") return "verify";
  const mode = url.searchParams.get("mode") as AccountMode;
  return modes.includes(mode) ? mode : "login";
}
export function captureAccountToken(url: URL, history: Pick<History, "replaceState">): string {
  const token = new URLSearchParams(url.hash.slice(1)).get("token") ?? "";
  if (url.hash) history.replaceState(null, "", `${url.pathname}${url.search}`);
  return token;
}
// Capture before React's StrictMode can replay initializers and before any request starts.
const initialToken = typeof window === "undefined" ? "" : captureAccountToken(new URL(window.location.href), window.history);
function clearWorkspaceSelection() {
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem("obb-selected-auction"); } catch { /* Storage can be disabled. */ }
  }
}

type SessionState = { view: SessionView | null; busy: boolean; blocked: boolean; expired: boolean };
// One owner serializes cookie-changing requests and guards their fully decoded results.
export class SessionOwner {
  private state: SessionState = { view: null, busy: true, blocked: false, expired: false };
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: SessionState) { this.state = state; this.listeners.forEach(listener => listener()); }
  expire(expired = true) {
    this.generation++;
    setSessionCsrf("");
    clearWorkspaceSelection();
    this.publish({ view: null, busy: false, blocked: this.state.blocked, expired });
  }
  run(work: () => Promise<SessionView>): Promise<void> {
    const generation = ++this.generation;
    this.publish({ ...this.state, busy: true });
    const result = this.queue.catch(() => {}).then(async () => {
      if (generation !== this.generation) return;
      try {
        const view = await work();
        if (generation !== this.generation) return;
        setSessionCsrf(view.csrfToken);
        this.publish({ view, busy: false, blocked: false, expired: !view.user && this.state.expired });
      } finally {
        if (generation === this.generation) this.publish({ ...this.state, busy: false });
      }
    });
    this.queue = result;
    return result;
  }
  logout(work = authApi.logout): Promise<void> {
    const csrf = this.state.view?.csrfToken ?? "";
    this.generation++;
    setSessionCsrf(csrf);
    clearWorkspaceSelection();
    this.publish({ view: null, busy: true, blocked: true, expired: false });
    const result = this.queue.catch(() => {}).then(async () => {
      try {
        if (!csrf) {
          const view = await authApi.session();
          setSessionCsrf(view.csrfToken);
        }
        await work();
        setSessionCsrf("");
      } catch (error) {
        setSessionCsrf("");
        this.publish({ view: null, busy: false, blocked: true, expired: false });
        throw error;
      }
    });
    this.queue = result;
    return result.then(() => this.run(authApi.session));
  }
}

export function AccountScreen({ owner, mode, token, lang, onMode }: {
  owner: SessionOwner; mode: AccountMode; token: string; lang: Lang; onMode: (mode: AccountMode) => void;
}) {
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [consumed, setConsumed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const operation = useRef(0);
  useEffect(() => {
    operation.current++;
    setPassword(""); setMessage(""); setError(""); setPending(false);
    heading.current?.focus();
    return () => { operation.current++; };
  }, [mode]);
  const view = state.view;
  const mail = !!view?.mailEnabled;
  const google = !!view?.googleEnabled;
  const invalidToken = (mode === "reset" || mode === "verify") && !token;
  const passwordNeeded = ["login", "register", "reset", "reauth"].includes(mode);
  const emailNeeded = ["login", "register", "forgot"].includes(mode);
  const unavailable = !mail && ["register", "forgot"].includes(mode);
  const disabled = pending || state.busy || !view || unavailable || invalidToken || consumed;
  const title = t(lang, `auth_${mode}`);
  const returnTo = typeof window === "undefined" ? "/app" : postLoginDestination(new URL(window.location.href));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const current = ++operation.current;
    setPending(true); setError(""); setMessage("");
    try {
      if (mode === "login") await owner.run(() => authApi.login(email, password));
      else if (mode === "register") { await authApi.register({ username, email, password }); }
      else if (mode === "forgot") await authApi.forgotPassword(email);
      else if (mode === "reset") {
        await authApi.resetPassword(token, password);
        if (current !== operation.current) return;
        setPassword("");
        setConsumed(true);
        setMessage(t(lang, "auth_done"));
        owner.expire(false);
        await owner.run(async () => ({ ...await authApi.session(), user: null })).catch(() => {
          if (current === operation.current) setError(t(lang, "auth_serviceError"));
        });
        return;
      }
      else if (mode === "verify") await authApi.verifyEmail(token);
      else if (mode === "reauth" || mode === "link") {
        if (!view?.user) { onMode("login"); return; }
        if (mode === "reauth") await authApi.reauthenticate(password);
        if (current !== operation.current) return;
        const result = await authApi.linkGoogle(returnTo);
        if (current === operation.current) window.location.assign(result.url);
      }
      if (current !== operation.current) return;
      setPassword("");
      if (mode === "verify") setConsumed(true);
      setMessage(t(lang, ["register", "forgot"].includes(mode) ? "auth_mailSent" : "auth_done"));
    } catch (cause) {
      if (current !== operation.current) return;
      setError(t(lang, cause instanceof ApiError && cause.status === 429 ? "auth_rateLimit" : cause instanceof ApiError && cause.status === 503 ? "auth_serviceError" : "auth_error"));
      if (mode === "link" && cause instanceof ApiError && cause.status === 403) onMode("reauth");
    } finally { if (current === operation.current) setPending(false); }
  }
  return <main className="account-shell">
    <a className="account-brand" href="/">2 Ordular savaşı</a>
    <section className="account-panel" aria-labelledby="account-title">
      <h1 id="account-title" ref={heading} tabIndex={-1}>{title}</h1>
      <p>{t(lang, "auth_intro")}</p>
      {state.expired && <p role="status">{t(lang, "auth_expired")}</p>}
      {invalidToken && <p role="status">{t(lang, "auth_invalidToken")}</p>}
      {unavailable && <p role="status">{t(lang, "auth_mailUnavailable")}</p>}
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!invalidToken && !consumed && <form onSubmit={submit} aria-busy={pending}>
        {mode === "register" && <label htmlFor="account-username">{t(lang, "auth_username")}<input id="account-username" name="username" autoComplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" value={username} onChange={e => setUsername(e.target.value)} /></label>}
        {emailNeeded && <label htmlFor="account-email">{t(lang, mode === "login" ? "auth_loginId" : "auth_email")}<input id="account-email" name="email" type={mode === "login" ? "text" : "email"} autoComplete={mode === "login" ? "username" : "email"} required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {passwordNeeded && <label htmlFor="account-password"><span id="password-label">{t(lang, "auth_password")}</span><input id="account-password" name="password" type="password" autoComplete={mode === "register" || mode === "reset" ? "new-password" : "current-password"} required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} aria-labelledby="password-label" aria-describedby="password-hint" /><small id="password-hint">{t(lang, "auth_passwordHint")}</small></label>}
        <button className="primary" type="submit" disabled={disabled || ((mode === "link" || mode === "reauth") && !google)}>{pending ? t(lang, "auth_working") : title}</button>
      </form>}
      {(mode === "login" || mode === "register") && <>
        {google ? <a className="account-google" href={authApi.googleStartUrl(returnTo)}>{t(lang, "auth_google")}</a> : <p className="account-note">{t(lang, "auth_googleUnavailable")}</p>}
        <nav className="account-links" aria-label={t(lang, "auth_account")}>
          <button type="button" disabled={pending} onClick={() => onMode(mode === "login" ? "register" : "login")}>{t(lang, mode === "login" ? "auth_register" : "auth_login")}</button>
          <button type="button" disabled={pending} onClick={() => onMode("forgot")}>{t(lang, "auth_forgot")}</button>
        </nav>
      </>}
      {(mode === "link" || mode === "reauth") && !google && <p role="status">{t(lang, "auth_googleUnavailable")}</p>}
      {mode === "register" && mail && <button type="button" disabled={pending || !email} onClick={async () => {
        const current = ++operation.current; setPending(true); setError("");
        try { await authApi.resendVerification(email); if (current === operation.current) setMessage(t(lang, "auth_mailSent")); }
        catch { if (current === operation.current) setError(t(lang, "auth_serviceError")); }
        finally { if (current === operation.current) setPending(false); }
      }}>{t(lang, "auth_resend")}</button>}
      {!["login", "register"].includes(mode) && <button type="button" disabled={pending} onClick={() => onMode("login")}>{t(lang, "auth_login")}</button>}
      {mode === "forgot" && <p className="account-note">{t(lang, "auth_googleRecovery")}</p>}
    </section>
  </main>;
}

export function SessionBoundary({ children }: { children: (user: AuthUser) => React.ReactNode }) {
  const [owner] = useState(() => new SessionOwner());
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  const [lang, setLanguage] = useState<Lang>(getLang);
  const [route, setRoute] = useState(() => new URL(window.location.href));
  const [token] = useState(initialToken);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState(false);
  const mode = accountRoute(route);
  useEffect(() => {
    let refreshing = false;
    const off = subscribeUnauthorized(() => {
      owner.expire();
      if (owner.snapshot().blocked || refreshing) return;
      refreshing = true;
      // Refresh anonymous CSRF without ever reviving a private workspace on an auth 401.
      void owner.run(async () => ({ ...await authApi.session(), user: null })).catch(() => setError(true)).finally(() => { refreshing = false; });
    });
    void owner.run(authApi.session).catch(() => setError(true)).finally(() => setInitialized(true));
    const onPop = () => setRoute(new URL(window.location.href));
    const onLanguage = () => { const lang = getLang(); setLanguage(lang); document.documentElement.lang = lang; };
    window.addEventListener("popstate", onPop);
    window.addEventListener("obb-language", onLanguage);
    return () => { off(); owner.expire(false); window.removeEventListener("popstate", onPop); window.removeEventListener("obb-language", onLanguage); };
  }, [owner]);
  function navigate(mode: AccountMode) {
    const destination = postLoginDestination(new URL(window.location.href));
    const url = new URL(`/account?${new URLSearchParams({ mode, returnTo: destination })}`, window.location.origin);
    window.history.pushState(null, "", url); setRoute(url);
  }
  const account = route.pathname.startsWith("/account");
  const publicRoot = route.pathname === "/" && !route.searchParams.has("tab");
  const sensitive = mode === "reset" || mode === "verify";
  const showWorkspace = !publicRoot && !!state.view?.user && !state.busy && (!account || (!sensitive && mode !== "link" && mode !== "reauth"));
  useEffect(() => {
    if (!initialized || state.busy || state.view?.user || state.blocked) return;
    if (route.pathname !== "/app" && !(route.pathname === "/" && route.searchParams.has("tab"))) return;
    const url = new URL(`/account?${new URLSearchParams({ mode: "login", returnTo: postLoginDestination(route) })}`, window.location.origin);
    window.history.replaceState(null, "", url);
    setRoute(url);
  }, [initialized, state, route]);
  useEffect(() => {
    if (!showWorkspace) return;
    const destination = postLoginDestination(route);
    if (`${window.location.pathname}${window.location.search}` !== destination) {
      window.history.replaceState(null, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [showWorkspace, account, route]);
  return <>
    <div className="account-toolbar">
      <button type="button" onClick={() => { const next = lang === "tr" ? "en" : "tr"; setLang(next); setLanguage(next); document.documentElement.lang = next; }}>{lang === "tr" ? "English" : "Türkçe"}</button>
      {state.view?.user && <><span>{state.view.user.username}</span><button type="button" onClick={() => navigate("link")}>{t(lang, "auth_link")}</button></>}
      {(state.view?.user || state.blocked) && <button type="button" disabled={state.busy} onClick={() => { setError(false); void owner.logout().catch(() => setError(true)); }}>{t(lang, "auth_logout")}</button>}
    </div>
    {error && <p className="account-error" role="alert">{t(lang, state.blocked ? "auth_logoutError" : "auth_serviceError")}</p>}
    {publicRoot ? <LandingPage lang={lang} onStart={() => {
      const url = new URL(state.view?.user && !state.busy && !state.blocked ? "/app" : "/account", window.location.origin);
      window.history.pushState(null, "", url); setRoute(url);
    }} /> : !initialized || (state.busy && !!state.view?.user) ? <main className="account-shell" role="status">{t(lang, "auth_working")}</main> : state.blocked ? <main className="account-shell">{t(lang, "auth_logoutError")}</main> : showWorkspace ? <React.Fragment key={state.view!.user!.id}>{children(state.view!.user!)}</React.Fragment> : <>
      {!state.view && <button type="button" onClick={() => { setError(false); void owner.run(async () => ({ ...await authApi.session(), user: null })).catch(() => setError(true)); }}>{t(lang, "auth_retry")}</button>}
      <AccountScreen key={mode} owner={owner} mode={!state.view?.user && (mode === "link" || mode === "reauth") ? "login" : mode} token={token} lang={lang} onMode={navigate} />
    </>}
  </>;
}
