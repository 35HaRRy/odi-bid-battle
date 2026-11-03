import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { AuthStore, AUTH_RATE_LIMITS, authRateLimitKey, isAccountEmail, type AuthUser } from "./auth-store.js";
import { hashToken, newToken } from "./auth-crypto.js";
import type { AuthConfig } from "./auth-config.js";
import { accountMailUrl, type AccountMailer } from "./auth-mail.js";

export interface SessionView { user: AuthUser | null; csrfToken: string }

function cookie(req: Request, name: string): string {
  const matches = (req.headers.cookie ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : "";
}
function names(config: AuthConfig) {
  const prefix = config.production ? "__Host-" : "";
  return { session: prefix + "odi_session", anonymous: prefix + "odi_anon_csrf" };
}
function options(config: AuthConfig, maxAge: number) {
  return { httpOnly: true, secure: config.production, sameSite: "lax" as const, path: "/", maxAge };
}
function error(res: Response, status: number, message: string) { return res.status(status).json({ error: message }); }
function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(() => error(res, 503, "Service unavailable; retry later"));
  };
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
      const csrf = req.get("X-CSRF-Token") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(csrf)) return error(res, 403, "Forbidden");
      if (res.locals.user) {
        if (!await auth.verifySessionCsrf(token, csrf)) return error(res, 403, "Forbidden");
      } else {
        const digest = cookie(req, names(config).anonymous);
        if (!/^[a-f0-9]{64}$/.test(digest) || !timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(hashToken(csrf), "hex"))) return error(res, 403, "Forbidden");
      }
    }
    next();
  }));
}

export function mountAuthRoutes(app: Express, auth: AuthStore, config: AuthConfig, mail: AccountMailer): void {
  const cookies = names(config);
  const send = (to: string, purpose: "verify_email" | "reset_password", token: string) => mail.sendAccountMail({ to, purpose, url: accountMailUrl(config.appUrl, purpose, token) });
  async function budget(res: Response, action: "registration" | "recovery" | "resend", account: string, ip: string): Promise<boolean> {
    const policy = AUTH_RATE_LIMITS[action];
    const checks = await Promise.all((["account", "ip"] as const).map(scope => auth.consumeRateLimit(authRateLimitKey(action, scope, scope === "ip" ? ip : account), policy.limit, policy.windowSeconds)));
    if (checks.every(Boolean)) return true;
    res.setHeader("Retry-After", String(policy.windowSeconds)); error(res,429,"Too many attempts; retry later"); return false;
  }
  app.get("/auth/session", asyncRoute(async (req, res) => {
    if ((req.get("Origin") && req.get("Origin") !== config.allowedOrigin) || req.get("Sec-Fetch-Site") === "cross-site") return error(res,403,"Forbidden");
    const csrfToken = res.locals.user ? await auth.rotateSessionCsrf(res.locals.sessionToken) : newToken();
    if (!res.locals.user) {
      res.cookie(cookies.session,"",options(config,0));
      res.cookie(cookies.anonymous,hashToken(csrfToken),options(config,3600000));
    }
    return res.json({ user: res.locals.user, csrfToken } satisfies SessionView);
  }));
  app.post("/auth/login", asyncRoute(async (req, res) => {
    const login = typeof req.body?.login === "string" ? req.body.login : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (login.length > 254) return error(res,400,"Invalid input");
    const identity = await auth.loginRateIdentity(login);
    const keys = [authRateLimitKey("login", "account", identity),authRateLimitKey("login","ip",req.ip ?? "unknown")];
    const policies = [AUTH_RATE_LIMITS.loginAccount, AUTH_RATE_LIMITS.loginIp];
    if (!(await Promise.all(keys.map((key,i)=>auth.rateLimitAvailable(key,policies[i].limit)))).every(Boolean)) {
      res.setHeader("Retry-After","900"); return error(res,429,"Too many attempts; retry later");
    }
    const result = await auth.authenticateLocalUser(login,password);
    if (!result) {
      const checks = await Promise.all(keys.map((key,i)=>auth.consumeRateLimit(key,policies[i].limit,policies[i].windowSeconds)));
      const allowed = checks.every(Boolean);
      if (!allowed) res.setHeader("Retry-After","900");
      return error(res,allowed ? 401 : 429,allowed ? "Invalid credentials" : "Too many attempts; retry later");
    }
    if (res.locals.sessionToken) await auth.revokeSession(res.locals.sessionToken);
    res.cookie(cookies.session,result.token,options(config,7*86400000));
    res.cookie(cookies.anonymous,"",options(config,0));
    return res.json({user:result.user,csrfToken:result.csrfToken} satisfies SessionView);
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
      typeof password !== "string" || password.length < 12 || password.length > 128
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
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof password !== "string" || password.length<12 || password.length>128) return error(res,400,"Invalid input");
    if (!await auth.consumePasswordResetToken(token,password)) return error(res,400,"Invalid or expired link");
    return res.status(204).end();
  }));
}
