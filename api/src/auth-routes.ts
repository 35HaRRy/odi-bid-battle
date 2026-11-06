import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { AuthStore, AUTH_RATE_LIMITS, authRateLimitKey, isAccountEmail, type AuthUser } from "./auth-store.js";
import { csrfForCookie, hashToken, newToken, validPassword } from "./auth-crypto.js";
import type { AuthConfig } from "./auth-config.js";
import { accountMailUrl, type AccountMailer } from "./auth-mail.js";

export interface SessionView { user: AuthUser | null; csrfToken: string; googleEnabled: boolean; mailEnabled: boolean }

export function cookie(req: Request, name: string): string {
  const matches = (req.headers.cookie ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : "";
}
export function names(config: AuthConfig) {
  const prefix = config.production ? "__Host-" : "";
  return { session: prefix + "odi_session", anonymous: prefix + "odi_anon_csrf" };
}
export function options(config: AuthConfig, maxAge: number) {
  return { httpOnly: true, secure: config.production, sameSite: "lax" as const, path: "/", maxAge };
}
export function error(res: Response, status: number, message: string) { return res.status(status).json({ error: message }); }
export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(() => error(res, 503, "Service unavailable; retry later"));
  };
}

export async function establishSession(res: Response, auth: AuthStore, config: AuthConfig, token: string): Promise<void> {
  if (res.locals.sessionToken && res.locals.sessionToken !== token) await auth.revokeSession(res.locals.sessionToken);
  res.cookie(names(config).session,token,options(config,7*86400000));
  res.cookie(names(config).anonymous,"",options(config,0));
}

export function mountAuthSecurity(app: Express, auth: AuthStore, config: AuthConfig): void {
  app.set("trust proxy", config.trustedProxies.length ? config.trustedProxies : false);
  app.use(asyncRoute(async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const token = cookie(req, names(config).session);
    res.locals.sessionToken = token;
    res.locals.user = token ? await auth.resolveSession(token) : null;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("Origin") !== config.allowedOrigin) return error(res, 403, "Forbidden");
      if (token && !res.locals.user) return error(res, 401, "Authentication required");
      const csrf = req.get("X-CSRF-Token") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrf)) return error(res, 403, "Forbidden");
      if (res.locals.user) {
        if (!await auth.verifySessionCsrf(token, csrf)) return error(res, 403, "Forbidden");
      } else {
        const secret = cookie(req, names(config).anonymous);
        if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || !timingSafeEqual(Buffer.from(hashToken(csrfForCookie(secret, "anonymous")), "hex"), Buffer.from(hashToken(csrf), "hex"))) return error(res, 403, "Forbidden");
      }
    }
    next();
  }));
}

export function mountAuthRoutes(app: Express, auth: AuthStore, config: AuthConfig, mail: AccountMailer): void {
  const cookies = names(config);
  const capabilities = {googleEnabled:!!config.google,mailEnabled:mail.enabled};
  const send = (to: string, purpose: "verify_email" | "reset_password", token: string) => mail.sendAccountMail({ to, purpose, url: accountMailUrl(config.appUrl, purpose, token) });
  async function budget(res: Response, action: "registration" | "recovery" | "resend", account: string, ip: string): Promise<boolean> {
    const policy = AUTH_RATE_LIMITS[action];
    const checks = await Promise.all((["account", "ip"] as const).map(scope => auth.consumeRateLimit(authRateLimitKey(action, scope, scope === "ip" ? ip : account), policy.limit, policy.windowSeconds)));
    if (checks.every(Boolean)) return true;
    res.setHeader("Retry-After", String(policy.windowSeconds)); error(res,429,"Too many attempts; retry later"); return false;
  }
  app.get("/auth/session", asyncRoute(async (req, res) => {
    if ((req.get("Origin") && req.get("Origin") !== config.allowedOrigin) || req.get("Sec-Fetch-Site") === "cross-site") return error(res,403,"Forbidden");
    let csrfToken: string;
    if (res.locals.user) csrfToken = await auth.sessionCsrf(res.locals.sessionToken);
    if (!res.locals.user) {
      const existing = cookie(req, cookies.anonymous);
      const secret = /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : newToken();
      csrfToken = csrfForCookie(secret, "anonymous");
      res.cookie(cookies.session,"",options(config,0));
      if (secret !== existing) res.cookie(cookies.anonymous,secret,options(config,3600000));
    }
    return res.json({ user: res.locals.user, csrfToken: csrfToken!, ...capabilities } satisfies SessionView);
  }));
  app.post("/auth/login", asyncRoute(async (req, res) => {
    const login = typeof req.body?.login === "string" ? req.body.login : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (login.length > 254) return error(res,400,"Invalid input");
    const result = await auth.loginLocalUser(login,password,req.ip ?? "unknown");
    if (result.status !== 200) {
      if (result.status === 429) res.setHeader("Retry-After","900");
      return error(res,result.status,result.status === 401 ? "Invalid credentials" : "Too many attempts; retry later");
    }
    await establishSession(res,auth,config,result.token);
    return res.json({user:result.user,csrfToken:result.csrfToken,...capabilities} satisfies SessionView);
  }));
  app.post("/auth/reauthenticate",asyncRoute(async(req,res)=>{
    if (!res.locals.user) return error(res,401,"Authentication required");
    const result = await auth.reauthenticateLocalSession(res.locals.sessionToken,typeof req.body?.password === "string" ? req.body.password : "",req.ip ?? "unknown");
    if (result.status !== 200) {
      if (result.status === 429) res.setHeader("Retry-After","900");
      return error(res,result.status,result.status === 401 ? "Invalid credentials" : "Too many attempts; retry later");
    }
    return res.status(204).end();
  }));
  app.post("/auth/logout",asyncRoute(async (_req,res)=>{
    if (res.locals.sessionToken) await auth.revokeSession(res.locals.sessionToken);
    res.cookie(cookies.session,"",options(config,0)); res.cookie(cookies.anonymous,"",options(config,0));
    return res.status(204).end();
  }));
  app.post("/auth/register",asyncRoute(async(req,res)=>{
    if (!await budget(res,"registration",String(req.body?.email ?? ""),req.ip ?? "unknown")) return;
    await mail.verify();
    const {username,email,password} = req.body ?? {};
    if (
      typeof username !== "string" || !/^[a-z0-9_]{3,32}$/.test(username.trim().toLowerCase()) || username.trim().toLowerCase() === "legacy" ||
      typeof email !== "string" || !isAccountEmail(email.trim()) ||
      typeof password !== "string" || !validPassword(password)
    ) return error(res,400,"Invalid input");
    try { await auth.createLocalUser({username,email,password},(user,token)=>send(user.email,"verify_email",token)); }
    catch(err) {
      if ((err as {code?:string}).code !== "23505") throw err;
      await send(email.trim().toLowerCase(),"verify_email",newToken());
    }
    return res.status(202).json({ok:true});
  }));
  for (const [path,action,purpose] of [["forgot-password","recovery","reset_password"],["resend-verification","resend","verify_email"]] as const) {
    app.post(`/auth/${path}`,asyncRoute(async(req,res)=>{
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!await budget(res,action,email,req.ip ?? "unknown")) return;
      await mail.verify();
      if (!isAccountEmail(email)) return error(res,400,"Invalid input");
      await auth.deliverAccountToken(email,purpose,(to,token)=>send(to,purpose,token));
      return res.status(202).json({ok:true});
    }));
  }
  app.post("/auth/verify-email",asyncRoute(async(req,res)=>{
    const token = req.body?.token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || !await auth.consumeVerificationToken(token)) return error(res,400,"Invalid or expired link");
    return res.status(204).end();
  }));
  app.post("/auth/reset-password",asyncRoute(async(req,res)=>{
    const {token,password} = req.body ?? {};
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof password !== "string" || !validPassword(password)) return error(res,400,"Invalid input");
    if (!await auth.consumePasswordResetToken(token,password)) return error(res,400,"Invalid or expired link");
    return res.status(204).end();
  }));
}
