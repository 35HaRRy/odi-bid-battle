import { describe, expect, it, vi } from "vitest";
import { createAccountMailer } from "../src/auth-mail.js";
import { loadAuthConfig } from "../src/auth-config.js";

describe("account SMTP delivery", () => {
  it("only succeeds after recipient acceptance and redacts SMTP errors", async () => {
    const sent: unknown[] = [];
    let reject = false;
    const mail = createAccountMailer({ from: "sender@example.test", transport: {
      async verify() { return true; },
      async sendMail(input) { sent.push(input); return { accepted: reject ? [] : ["recipient@example.test"], rejected: reject ? ["recipient@example.test"] : [] }; },
    } });
    expect(mail.enabled).toBe(true);
    await mail.verify();
    await expect(mail.sendAccountMail({ to: "recipient@example.test", purpose: "verify_email", url: "https://example.test/account/verify-email#token=opaque" })).resolves.toBeUndefined();
    expect(sent[0]).toMatchObject({ to: "recipient@example.test", from: "sender@example.test", text: expect.stringContaining("https://example.test/account/verify-email#token=opaque") });
    reject = true;
    await expect(mail.sendAccountMail({ to: "recipient@example.test", purpose: "reset_password", url: "https://example.test/account/reset-password#token=opaque" })).rejects.toThrow("Mail unavailable");
  });
  it("fails closed without SMTP, validates production HTTPS and explicit proxy configuration", async () => {
    const config = loadAuthConfig({ NODE_ENV: "production", APP_URL: "https://example.test", ALLOWED_ORIGIN: "https://example.test" });
    expect(config.production).toBe(true); expect(config.trustedProxies).toEqual([]);
    await expect(createAccountMailer().verify()).rejects.toThrow("Mail unavailable");
    expect(createAccountMailer().enabled).toBe(false);
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", APP_URL: "http://example.test", ALLOWED_ORIGIN: "http://example.test" }, { TRUSTED_PROXIES: "true" }]) expect(() => loadAuthConfig(env)).toThrow();
  });
  it("reports configured SMTP capability without making a network request",()=>{
    try {
      for(const [name,value] of Object.entries({SMTP_HOST:"smtp.example.test",SMTP_FROM:"sender@example.test",SMTP_PORT:"587",SMTP_SECURE:"false",SMTP_USER:"",SMTP_PASS:""})) vi.stubEnv(name,value);
      expect(createAccountMailer().enabled).toBe(true);
      vi.stubEnv("SMTP_PORT","invalid"); expect(createAccountMailer().enabled).toBe(false);
      vi.stubEnv("SMTP_PORT","587"); vi.stubEnv("SMTP_USER","user"); expect(createAccountMailer().enabled).toBe(false);
    } finally {vi.unstubAllEnvs();}
  });
});
