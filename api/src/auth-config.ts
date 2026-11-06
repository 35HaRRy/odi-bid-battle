import { isIP } from "node:net";

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateEncryptionKey: string;
}

export interface AuthConfig {
  allowedOrigin: string;
  appUrl: string;
  production: boolean;
  trustedProxies: string[];
  google?: GoogleSettings;
}

export function validateAuthConfig(config: AuthConfig): AuthConfig {
  for (const value of [config.allowedOrigin, config.appUrl]) {
    const url = new URL(value);
    if (url.origin !== value || !["http:", "https:"].includes(url.protocol) || (config.production && url.protocol !== "https:")) throw new Error("Auth URLs must be fixed origins (HTTPS in production)");
  }
  for (const proxy of config.trustedProxies) {
    const [ip, bits, extra] = proxy.split("/");
    const version = isIP(ip);
    if (!version || extra || (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > (version === 4 ? 32 : 128)))) throw new Error("TRUSTED_PROXIES must contain explicit IP addresses/CIDRs");
  }
  if (config.google) {
    const g = config.google;
    const url = new URL(g.redirectUri);
    if (!g.clientId.trim() || !g.clientSecret.trim() || !/^[A-Za-z0-9+/]{43}=$/.test(g.stateEncryptionKey) || Buffer.from(g.stateEncryptionKey,"base64").length !== 32 ||
      url.search || url.hash || url.username || url.password || !["/auth/google/callback","/api/auth/google/callback"].includes(url.pathname) ||
      (config.production ? url.protocol !== "https:" || url.origin !== config.appUrl : url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))) throw new Error("Invalid Google authentication configuration");
  }
  return config;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === "production";
  if (production && (!env.ALLOWED_ORIGIN || !env.APP_URL)) throw new Error("APP_URL and ALLOWED_ORIGIN are required");
  const values = [env.GOOGLE_CLIENT_ID,env.GOOGLE_CLIENT_SECRET,env.GOOGLE_REDIRECT_URI,env.AUTH_STATE_ENCRYPTION_KEY];
  if (values.some(v=>v !== undefined) && !values.every(v=>!!v?.trim())) throw new Error("Complete Google authentication configuration required");
  return validateAuthConfig({
    allowedOrigin: env.ALLOWED_ORIGIN ?? "http://localhost:5173",
    appUrl: env.APP_URL ?? "http://localhost:5173",
    production,
    trustedProxies: env.TRUSTED_PROXIES?.split(",").map(s => s.trim()).filter(Boolean) ?? [],
    ...(values.every(Boolean) ? {google:{clientId:values[0]!,clientSecret:values[1]!,redirectUri:values[2]!,stateEncryptionKey:values[3]!}} : {}),
  });
}
