import nodemailer from "nodemailer";
import { isAccountEmail, type TokenPurpose } from "./auth-store.js";

export interface AccountMail { to: string; purpose: TokenPurpose; url: string }
export interface AccountMailer {
  verify(): Promise<void>;
  sendAccountMail(input: AccountMail): Promise<void>;
}
interface MailTransport {
  verify(): Promise<unknown>;
  sendMail(input: { from: string; to: string; subject: string; text: string; disableFileAccess: boolean; disableUrlAccess: boolean }): Promise<{ accepted: unknown[]; rejected: unknown[] }>;
}

export function accountMailUrl(appUrl: string, purpose: TokenPurpose, token: string): string {
  const url = new URL(purpose === "verify_email" ? "/account/verify-email" : "/account/reset-password", appUrl);
  // Fragments never travel in HTTP access logs or Referer headers.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export function createAccountMailer(options?: { from: string; transport: MailTransport }): AccountMailer {
  let transport = options?.transport;
  const from = options?.from ?? process.env.SMTP_FROM;
  if (!options && process.env.SMTP_HOST && from) {
    const port = Number(process.env.SMTP_PORT);
    const secure = process.env.SMTP_SECURE;
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (Number.isInteger(port) && port > 0 && port <= 65535 && ["true", "false"].includes(secure ?? "") && !!user === !!pass) {
      transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: secure === "true", requireTLS: secure !== "true",
        auth: user && pass ? { user, pass } : undefined,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      });
    }
  }
  return {
    async verify() {
      try { if (!transport || !from) throw new Error(); await transport.verify(); }
      catch { throw new Error("Mail unavailable"); }
    },
    async sendAccountMail(input) {
      try {
        if (!transport || !from || !isAccountEmail(input.to)) throw new Error();
        const verify = input.purpose === "verify_email";
        const result = await transport.sendMail({ from, to: input.to, subject: verify ? "Verify your email / E-postanı doğrula" : "Reset your password / Şifreni sıfırla",
          text: `${verify ? "Verify your email / E-postanı doğrula (24h)" : "Set a new password / Yeni şifre belirle (30min)"}:\n${input.url}\n\nIf you did not request this, ignore this email. / Bu isteği sen yapmadıysan bu e-postayı yok say.`,
          disableFileAccess: true, disableUrlAccess: true,
        });
        if (!result.accepted.length || result.rejected.length) throw new Error();
      } catch { throw new Error("Mail unavailable"); }
    },
  };
}

export async function sendAccountMail(input: AccountMail): Promise<void> {
  await createAccountMailer().sendAccountMail(input);
}
