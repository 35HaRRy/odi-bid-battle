import { Pool } from "pg";
import { AuthStore } from "../src/auth-store.js";
import { loadAuthConfig } from "../src/auth-config.js";
import { accountMailUrl, createAccountMailer } from "../src/auth-mail.js";

// Explicit operator action only; never called by either HTTP entry point.
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--confirm-legacy-claim" || !process.env.DATABASE_URL || !process.env.LEGACY_ACCOUNT_EMAIL) throw new Error("Provisioning configuration required");
  const email = process.env.LEGACY_ACCOUNT_EMAIL.trim().toLowerCase();
  const config = loadAuthConfig();
  const mail = createAccountMailer();
  await mail.verify();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await new AuthStore(pool).provisionLegacy(email,async invitation => {
      await mail.sendAccountMail({to:email,purpose:"verify_email",url:accountMailUrl(config.appUrl,"verify_email",invitation.verificationToken)});
      await mail.sendAccountMail({to:email,purpose:"reset_password",url:accountMailUrl(config.appUrl,"reset_password",invitation.resetToken)});
    });
    console.log("Legacy invitation accepted for delivery. Complete email verification and password setup.");
  } finally { await pool.end(); }
}

main().catch(() => {
  console.error("Legacy provisioning failed. Check configuration and account claim state, then retry with the approved recipient.");
  process.exitCode = 1;
});
