import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Express } from "express";
import * as oidc from "openid-client";
import { type AuthConfig, type GoogleSettings, validateAuthConfig } from "./auth-config.js";
import { AuthStore, AUTH_RATE_LIMITS, authRateLimitKey, isAccountEmail } from "./auth-store.js";
import { hashToken, newToken } from "./auth-crypto.js";
import { asyncRoute, cookie, error, establishSession, options } from "./auth-routes.js";

export type GoogleAuthConfig = AuthConfig & GoogleSettings;
const issuer = "https://accounts.google.com";
const opaque = /^[A-Za-z0-9_-]{43}$/;

function seal(verifier: string, key: Buffer, state: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from(hashToken(state)));
  const encrypted = Buffer.concat([cipher.update(verifier,"utf8"),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");
}
function unseal(value: string, key: Buffer, state: string): string {
  const bytes=Buffer.from(value,"base64url"), cipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));
  cipher.setAAD(Buffer.from(hashToken(state))); cipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString("utf8");
}
function returnPath(value: unknown, config: AuthConfig): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20\x7f]/.test(value)) return "/";
  const url=new URL(value,config.appUrl);
  return url.origin === config.appUrl ? url.pathname+url.search+url.hash : "/";
}

export function mountGoogleAuth(app: Express, auth: AuthStore, config: GoogleAuthConfig): void {
  validateAuthConfig({...config,google:config});
  const key=Buffer.from(config.stateEncryptionKey,"base64");
  const transactionCookie=(config.production ? "__Host-" : "")+"odi_google_tx";
  let discovery: Promise<oidc.Configuration> | undefined;
  const client = () => discovery ??= oidc.discovery(new URL(issuer),config.clientId,config.clientSecret,undefined,{
    execute:[oidc.enableNonRepudiationChecks],
  }).catch(err=>{discovery=undefined;throw err;});
  for (const link of [false,true]) {
    app[link ? "post" : "get"](link ? "/auth/google/link" : "/auth/google/start",asyncRoute(async(req,res)=>{
      if (link && !res.locals.user) return error(res,401,"Authentication required");
      if (!link && res.locals.user) return error(res,409,"Use explicit Google linking from your account");
      if (link && !await auth.recentlyReauthenticated(res.locals.sessionToken,res.locals.user.id)) return error(res,403,"Recent password reauthentication required");
      const policy=AUTH_RATE_LIMITS.googleStart;
      const scopes = link ? ["ip","account"] as const : ["ip"] as const;
      for (const scope of scopes) {
        if (!await auth.consumeRateLimit(authRateLimitKey("googleStart",scope,scope === "ip" ? req.ip ?? "unknown" : res.locals.user.id),policy.limit,policy.windowSeconds)) {
          res.setHeader("Retry-After",String(policy.windowSeconds)); return error(res,429,"Too many attempts; retry later");
        }
      }
      const provider=await client(), state=newToken(), browser=newToken(), nonce=newToken(), verifier=oidc.randomPKCECodeVerifier();
      const url=oidc.buildAuthorizationUrl(provider,{redirect_uri:config.redirectUri,scope:"openid email profile",state,nonce,
        code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:"S256"});
      await auth.saveOAuthState(state,browser,{nonce,verifier_ciphertext:seal(verifier,key,state),return_path:returnPath(link ? req.body?.returnTo : req.query.returnTo,config),
        link_user_id:link ? res.locals.user.id : null,link_session_hash:link ? hashToken(res.locals.sessionToken) : null});
      res.cookie(transactionCookie,browser,options(config,600000));
      return link ? res.json({url:url.href}) : res.redirect(url.href);
    }));
  }
  app.get("/auth/google/callback",asyncRoute(async(req,res)=>{
    const fail = (reason: "invalid" | "link_required" | "unavailable") => res.redirect(new URL(`/account?google=${reason}`,config.appUrl).href);
    try {
    const state=req.query.state, browser=cookie(req,transactionCookie);
    if (typeof state !== "string" || !opaque.test(state) || !opaque.test(browser)) return fail("invalid");
    const record=await auth.consumeOAuthState(state,browser);
    if (!record) return fail("invalid");
    res.cookie(transactionCookie,"",options(config,0));
    if (record.link_user_id && (res.locals.user?.id !== record.link_user_id || hashToken(res.locals.sessionToken) !== record.link_session_hash)) return fail("invalid");
    if (!record.link_user_id && res.locals.user) return fail("invalid");
    let identity: {issuer:string;subject:string;email:string;hostedDomain?:string};
    try {
      const provider=await client();
      // Use the configured callback origin/path, never Host or forwarded request headers.
      const callback=new URL(config.redirectUri); callback.search=new URL(req.originalUrl,"http://internal.invalid").search;
      const tokens=await oidc.authorizationCodeGrant(provider,callback,{expectedState:state,expectedNonce:record.nonce,
        pkceCodeVerifier:unseal(record.verifier_ciphertext,key,state),idTokenExpected:true});
      const claims=tokens.claims()!;
      const info=await oidc.fetchUserInfo(provider,tokens.access_token,claims.sub);
      if (claims.email_verified !== true || info.email_verified !== true || typeof claims.email !== "string" ||
        typeof info.email !== "string" || claims.email.toLowerCase() !== info.email.toLowerCase() || !isAccountEmail(claims.email.toLowerCase())) throw new Error("Unverified Google email");
      identity={issuer:claims.iss,subject:claims.sub,email:claims.email.toLowerCase(),
        hostedDomain:typeof claims.hd === "string" && claims.hd.trim() ? claims.hd : undefined};
    } catch { return fail("invalid"); }
    const result=await auth.finishGoogleIdentity(identity,record.link_user_id ? {userId:record.link_user_id,sessionHash:record.link_session_hash!} : undefined);
    if (result.status === 409) return fail("link_required");
    if (result.status === 403) return fail("unavailable");
    if (result.status === 200) await establishSession(res,auth,config,result.token);
    const destination=returnPath(record.return_path,config);
    return res.redirect(new URL(destination === "/" ? "/app" : destination,config.appUrl).href);
    } catch { return fail("unavailable"); }
  }));
}
