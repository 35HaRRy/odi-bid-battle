# Account API deployment

Deploy identity, ownership/API gate, UI and migration together in a maintenance window, after an approved backup and restore rehearsal. This intermediate task is **not independently deployable**. Never reopen an unauthenticated old API after migration.

## Configuration (standalone and Vercel)

- Node 24; existing PostgreSQL pool. `DATABASE_URL` is injected privately, never printed.
- `APP_URL`: fixed frontend origin, e.g. `https://app.example.test`. Links always target `/account/verify-email#token=…` or `/account/reset-password#token=…`; never request Host. Task 8 must read and immediately remove fragments from browser history, submit via POST, and set `Referrer-Policy: no-referrer` on account/token pages in frontend hosting headers. Never log request bodies, cookies, token fragments or links. API responses already set no-referrer and no-store.
- `ALLOWED_ORIGIN`: exactly one frontend origin, no trailing slash/path. Both URLs are mandatory and HTTPS-only with `NODE_ENV=production`. Development defaults to `http://localhost:5173`; credentials-enabled CORS permits only this configured origin. The production frontend/API must be same-site (prefer same origin `/api`); SameSite=Lax does not support cross-site cookie deployment.
- `TRUSTED_PROXIES`: empty by default; client IP is the socket address. Only explicit trusted proxy IPs/CIDRs are accepted, comma-separated. No `true`, hop counts or wildcard trust. Configure only known controlled proxies that overwrite forwarded headers, and prevent direct access around them. Verify the Vercel ingress contract/IP ranges before enabling trust; otherwise limits intentionally share the ingress IP rather than trust spoofable headers. This may constrain all users behind a proxy until configured.
- `SMTP_HOST`, `SMTP_PORT` (1–65535), `SMTP_SECURE` (`true` for implicit TLS, usually 465; `false` for required STARTTLS, usually 587), `SMTP_FROM`; optional `SMTP_USER` and `SMTP_PASS` must be configured together. TLS certificate validation stays enabled, SMTP debugging/logging stays disabled. Incomplete config makes mail routes return generic retryable 503; there is no console-link fallback. Preflight SMTP connection/auth verification happens before account-specific work. Only SMTP recipient acceptance counts as delivery success; this does not promise inbox delivery.
- Verify serverless outbound DNS/TCP/SMTP connectivity, provider restrictions, sender authorization, SPF/DKIM/DMARC and function timeouts. Every send and verify is awaited; no detached serverless background sends. SMTP connection/greeting timeout is 10 seconds, socket timeout 15 seconds. Budget for preflight plus delivery (provisioning sends two messages).

`buildApp(store, options?: AppOptions)` exports injectable validated config and `AccountMailer` for tests; neither auth nor CSRF can be disabled. Both runtime entry points explicitly load the same config. No real SMTP/Google or production migration was exercised during development.

## HTTP and security contracts

`GET /auth/session` returns `{user:null|{id,username,email},csrfToken}` and bootstraps anonymous CSRF. Send credentials/cookies on requests, `Origin: ALLOWED_ORIGIN` and `X-CSRF-Token` on **every unsafe request**, including login/register/reset/logout. Anonymous HttpOnly host-only cookie contains only the CSRF digest; authenticated CSRF digests are in `auth_sessions`. Login replaces anonymous state with a 7-day opaque session. Cookies are HttpOnly, SameSite=Lax, Path=/; production adds Secure and `__Host-` names. No Domain is set. Duplicate security cookie names fail closed. Session bootstrap rotates the CSRF value; tabs must use the latest bootstrap/login response (bootstrap again after logout/expired session/403). Never store credentials in localStorage. Session tokens and one-time tokens are stored only as SHA-256 digests.

POST endpoints: `/auth/register {username,email,password}` → 202, `/auth/login {login,password}` → SessionView, `/auth/logout` → 204, `/auth/forgot-password {email}` → 202, `/auth/resend-verification {email}` → 202, `/auth/verify-email {token}` → 204, `/auth/reset-password {token,password}` → 204. Passwords are 12–128 characters and never trimmed. Verification expires in 24 hours; reset in 30 minutes. Wrong/expired/reused links return generic 400. Reset revokes all sessions atomically. Unverified/disabled accounts cannot log in. A credential version/hash recheck and session insert share the account lock with password reset.

Login failures share one canonical account budget across username/email aliases (5/15min), plus IP (20/15min). Successful attempts do not consume failure counters, but cannot bypass an exhausted budget. Registration/recovery/resend each use separate account and IP budgets (5/hour); 429 carries Retry-After. Rate state is shared in PostgreSQL. KDF saturation/database failures map to generic retryable 503, never raw errors. Do not log request bodies at the proxy or hosting platform.

To avoid an SMTP-recipient-rejection account oracle, unknown/disabled recovery recipients, already-verified resend recipients and duplicate registration recipients receive the same kind of message with an unpersisted, unusable token. This is deliberately rate-limited; response status and SMTP failures do not disclose account existence. Receiving an email does not mean an account exists. No account/token is created by those dummy deliveries. Failed delivery rolls back newly created accounts/tokens; retry is safe. SMTP and PostgreSQL are not a distributed transaction: a message accepted immediately before a DB commit failure may contain an unusable link; retry through the form.

Public account routes and CSRF/session middleware are mounted **before** the mandatory domain gate added by Task 5. Task 5 must use `res.locals.user` as the actor, reject unauthenticated domain access with 401, and leave account/health routes public; do not move account routes behind the gate. No ownership bypass exists in this task.

## Operator legacy claim

After approval/backup/migration, privately supply `DATABASE_URL`, `LEGACY_ACCOUNT_EMAIL`, APP_URL/ALLOWED_ORIGIN and SMTP variables. Run with Node 24:

```text
pnpm --filter odi-bid-battle-api run provision-legacy --confirm-legacy-claim
```

No password, token, URL or recipient is emitted to stdout/stderr. The command preflights SMTP then holds the reserved legacy account row lock through email assignment, expiring verification/reset-token creation and both SMTP acceptances. Failure rolls back email assignment/new tokens; old invitation tokens remain valid after a failed retry. A successful same-recipient retry while pending replaces outstanding tokens. Different recipients and completed claims are rejected under the lock (including concurrent claims); unique email constraints remain enforced. There is no HTTP claim endpoint or administrator privilege.

The legacy account remains disabled until **both** the verification link and password-setup/reset link are consumed, in either order. Verification alone never creates a session. Ordinary recovery cannot activate the disabled legacy account; use the operator command to reissue expired pending invitations. After activation, normal recovery works. If one SMTP message was accepted but the second fails, rollback invalidates the accepted link; rerun with the same approved recipient. The operator must check approval/recipient out of band and should avoid concurrent duplicate command invocation. Never run this against a real database without explicit approval.
