import { isIP } from "node:net";

export interface AuthConfig {
  allowedOrigin: string;
  appUrl: string;
  production: boolean;
  trustedProxies: string[];
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
  return config;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === "production";
  if (production && (!env.ALLOWED_ORIGIN || !env.APP_URL)) throw new Error("APP_URL and ALLOWED_ORIGIN are required");
  return validateAuthConfig({
    allowedOrigin: env.ALLOWED_ORIGIN ?? "http://localhost:5173",
    appUrl: env.APP_URL ?? "http://localhost:5173",
    production,
    trustedProxies: env.TRUSTED_PROXIES?.split(",").map(s => s.trim()).filter(Boolean) ?? [],
  });
}
