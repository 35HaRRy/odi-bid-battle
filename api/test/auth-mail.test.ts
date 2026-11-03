import { describe, expect, it } from "vitest";
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
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", APP_URL: "http://example.test", ALLOWED_ORIGIN: "http://example.test" }, { TRUSTED_PROXIES: "true" }]) expect(() => loadAuthConfig(env)).toThrow();
  });
});
