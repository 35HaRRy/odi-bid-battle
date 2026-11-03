# User Authentication and Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require login, isolate each user's auctions, support opt-in library sharing, and introduce a public animated landing page.

**Architecture:** Keep the existing React/Vite frontend, Express API, PostgreSQL repositories, and Vercel entry point. Add database-backed authentication and immutable per-request user-scoped repositories, never a mutable user on the shared application store. Existing copy-on-edit and immutable auction history remain intact.

**Tech Stack:** TypeScript, React 18, Express 4, pg, Node 24 crypto, Vitest; planned security dependencies are `openid-client` for Google OIDC and `nodemailer` for SMTP (verify current Node 24-compatible APIs before implementation). CSS/IntersectionObserver for landing motion.

**Spec:** `docs/superpowers/specs/2026-11-03-user-auth-and-sharing-design.md`

## Global Constraints

- “Şifreler 12–128 karakterdir, kırpılmaz ve loglanmaz.”
- “Oturum 7 gün sonunda sona erer.”
- “Sıfırlama bağlantısı 30 dakika, doğrulama bağlantısı 24 saat geçerlidir.”
- “Yeni kayıtlar özel başlar.”
- “Public auction seçeneği yoktur.”
- “Başkasının özel kaydı yokmuş gibi 404, oturumsuz API isteği 401 döner.”
- “Mevcut React/Vite, Express, pg ve Vercel dağıtımı korunur.”
- “Google kimliği e-postayla değil issuer/subject ile eşlenir.”
- Follow ADR-0001, preserve all historical images and preparation locks, and keep Turkish/English UI parity.
- No runtime authentication bypass, public caching of private data, localStorage credential, production migration without backup/approval, or real secret in source/log/test fixture.
- Only change schema in a disposable test database during development; deployment and legacy account claiming are explicit operator actions.

## Review Focus

1. Two requests from different users overlap on one warm Vercel instance: user identity must never cross requests (Task 5 concurrency test).
2. A public list contains private candidates: contextual reads work without granting direct catalog/image access (Task 6 matrix test).
3. A source is hidden/archived/edited after another user selects it: old references remain usable without exposing future private revisions (Task 6 history test).
4. Verification/reset/OAuth callback is replayed or submitted simultaneously: only one valid consumption succeeds (Tasks 3–4 transaction tests).
5. Logout/login races with an old API response: previous user's data cannot reappear (Task 8 delayed-response test).

## File Map and Shared Contracts

New API files:
- `api/src/auth-crypto.ts`: password hashing, opaque tokens and hashes, no HTTP.
- `api/src/auth-store.ts`: users, sessions, one-time token transactions, shared rate limit storage.
- `api/src/auth-routes.ts`: account/session/verification/recovery endpoints and cookie/CSRF boundary.
- `api/src/auth-mail.ts`: configured SMTP delivery, no persistence of raw secrets.
- `api/src/auth-google.ts`: OIDC start/callback/linking, short-lived persisted state.
- `api/src/access.ts`: shared access errors, scoped identity and candidate context types.
- `api/tools/provision-legacy.ts`: operator-only legacy email claim invitation, never prints tokens.

Existing API files modified: `app.ts`, `store.ts`, `battlefield-store.ts`, `team-store.ts`, `live-store.ts`, their route modules and `server.ts`; `web/api/index.ts` supplies configuration for both entry points consistently.

New web files: `auth-api.ts` for account calls, `auth.tsx` for session boundary/account screen, `landing.tsx` and `landing.css` for public marketing, `sharing.tsx` for the repeated accessible checkbox controls. Existing `api.ts`, `App.tsx`, `battlefields.tsx`, `draft-teams.tsx`, `draft-review.tsx`, `live-council.tsx`, image components, `i18n.ts`, and styles receive only required integration changes.

Database: extend `db/schema.sql` idempotently. New tables `app_users`, `auth_sessions`, `auth_tokens`, `auth_google_identities`, `auth_oauth_states`, `auth_rate_limits`. Root resources receive `owner_user_id`; library roots also receive `is_public`. Extend identity fixtures in existing tests rather than exempting them from authentication.

Common types (API source and corresponding web DTOs):
```ts
type AuthUser = { id: string; username: string; email: string };
type SessionView = { user: AuthUser | null; csrfToken: string; googleEnabled: boolean; mailEnabled: boolean };
type Visibility = { ownerUserId: string; isPublic: boolean };
type CandidateContext = { listId: string } | { auctionId: string };
```
`Visibility` is added to candidate/list/battlefield DTOs only; auctions expose no sharing toggle. `GET /auth/session` issues an anonymous CSRF cookie/token when needed, returning `user:null` until authenticated. Anonymous and authenticated mutating calls both require allowed Origin and matching CSRF header. Authenticated tokens bind to a session. Raw CSRF material lives only in the cookie/browser memory; server validation uses hashes.

## Task 1: Schema, safe legacy migration, and identity fixtures

**Files:** Modify `db/schema.sql`; create `api/test/auth-migration.test.ts`, `api/test/helpers/auth.ts`, `api/tools/provision-legacy.ts`; modify `api/package.json` for the provisioning command.

**Interfaces:** `app_users` holds `id`, normalized unique `username`/`email` (email nullable only for locked legacy account), nullable `password_hash`, `email_verified_at`, `disabled_at`, timestamps. Token rows have purpose (`verify_email`/`reset_password`), hash, expiry and consumed timestamp. Sessions store token/CSRF hashes and expiry, never raw tokens. Legacy root ownership uses a deterministic reserved user ID, with no password and `disabled_at` set.

- [ ] Write migration tests asserting a seeded legacy graph retains every ID/image/reference; only legacy candidate/list/battlefield rows become public; auctions belong to the locked legacy owner. Apply twice and assert an added real user's private resource is unchanged. Assert all root owners are non-null and no default password exists.
- [ ] Run `corepack pnpm --filter odi-bid-battle-api exec vitest run test/auth-migration.test.ts`; expect failing missing identity/schema assertions. Tests must refuse a non-disposable DB rather than modifying the default developer database. Use an isolated schema/connection search_path fixture or dedicated test database.
- [ ] Implement transactional, idempotent backfill before NOT NULL/FK/index creation. Reserve legacy identity against ordinary registration. Provisioning signature `provisionLegacyUser(pool: Pool, email: string): Promise<void>` claims only the locked legacy account, prevents conflicts and concurrent double-claim, sends an expiring activation invitation through Task 3 delivery when available; until then test the transaction boundary and do not expose a runnable incomplete command.
- [ ] Run the migration test again; expect PASS. Add fixtures `createVerifiedUser(pool: Pool, username: string): Promise<AuthUser>` and `authenticatedClient(base: string, credentials: {login:string; password:string}): Promise<(path:string, init?:RequestInit)=>Promise<Response>>`; client performs real login, retains cookies and sends Origin/CSRF. No production helper routes.
- [ ] Commit only these schema/tests/provisioning changes after their checks pass: `git commit -m "feat: add user ownership schema and safe legacy migration"` (stage exact changed paths).

## Task 2: Passwords, sessions, shared rate limits

**Files:** Create `api/src/auth-crypto.ts`, `api/src/auth-store.ts`, `api/test/auth-crypto.test.ts`, `api/test/auth-store.test.ts`; extend schema test if table details change.

**Interfaces:** `hashPassword(password:string):Promise<string>`, `verifyPassword(password:string, encoded:string):Promise<boolean>`, `newToken():string`, `hashToken(token:string):string`. `AuthStore(pool:Pool)` provides `createLocalUser(input:{username:string;email:string;password:string}):Promise<AuthUser>`, `createSession(userId:string):Promise<{token:string;csrfToken:string;expiresAt:Date}>`, `resolveSession(token:string):Promise<AuthUser|null>`, `revokeSession(token:string):Promise<void>`, `consumeRateLimit(key:string, limit:number, windowSeconds:number):Promise<boolean>` and the one-time token operations used in Task 3. Session creation rejects disabled/unverified users.

- [ ] Write tests `password_is_salted_and_bounded` (two hashes differ, both verify; 11/129 rejected, 12/128 accepted, whitespace preserved), `session_stores_only_hashes_and_expires_at_7_days`, `disabled_and_unverified_users_cannot_start_sessions`, `parallel_rate_limit_is_shared_across_stores` (six atomic attempts with limit five yield exactly five successes). Malformed encodings reject safely and wrong/unknown account verification does equivalent expensive work.
- [ ] Run `corepack pnpm --filter odi-bid-battle-api exec vitest run test/auth-crypto.test.ts test/auth-store.test.ts`; expect FAIL for missing modules.
- [ ] Implement async scrypt with per-password salt, explicit bounded parameter parsing, timing-safe comparison and bounded expensive-job concurrency. Initial choice N=32768,r=8,p=1 with a sufficient maxmem; benchmark and record Node 24 warm/cold timing and memory before finalizing. Random tokens are at least 32 cryptographic bytes; hash with SHA-256. Use database atomic upsert for shared rate limits, expired row cleanup, and unique constraints for normalized account identities. Username format `[a-z0-9_]{3,32}`, normalized trim/lowercase; reject @ and reserved legacy name. Email trims/lowercases; password never trims.
- [ ] Run both test files and API typecheck; expect PASS. Account limits start at 5 failed login attempts/15 minutes per account plus 20/15 minutes per IP; registration/recovery/resend 5/hour per IP and account; Google start 20/15 minutes per IP. Normalize/derive opaque keys rather than storing raw passwords/tokens as keys; trust forwarded IP only from configured proxy.
- [ ] Stage exact files and commit `feat: add secure credentials and database sessions`.

## Task 3: Compact account API, verification and recovery

**Files:** Create `api/src/auth-routes.ts`, `api/src/auth-mail.ts`, `api/test/auth-routes.test.ts`, `api/test/auth-mail.test.ts`; modify `api/src/app.ts`, `api/src/server.ts`, `web/api/index.ts`, `api/package.json`, lockfile; create `docs/auth-deployment.md` and sanitized `api/.env.example`.

**Interfaces:** `buildApp(store:PgStore, options?:AppOptions):express.Express` loads validated environment configuration by default; test options may inject mail transport/clock but cannot disable security. `sendAccountMail(input:{to:string;purpose:'verify_email'|'reset_password';url:string}):Promise<void>` returns only after SMTP accepts. Account routes: `GET /auth/session`; `POST /auth/register {username,email,password}` → 202; `POST /auth/login {login,password}` → SessionView; `POST /auth/logout` → 204; `POST /auth/forgot-password {email}` → 202; `POST /auth/reset-password {token,password}` → 204; `POST /auth/verify-email {token}` → 204; `POST /auth/resend-verification {email}` → 202. Unavailable mail → generic 503 before account-specific processing. Errors never reveal whether a recovery account exists.

- [ ] Write HTTP tests for credentials/cookie flags, anonymous session CSRF bootstrap, bad Origin/CSRF 403, generic wrong/unknown login, duplicate registration generic response, verified-only login, expiry/reuse and concurrent reset/verification consumption, reset revoking all sessions, logout invalidation, configured rate limits 429, and SMTP failures. Assert hashes—not raw tokens—are stored; no sensitive responses are cacheable.
- [ ] Run `corepack pnpm --filter odi-bid-battle-api exec vitest run test/auth-routes.test.ts test/auth-mail.test.ts`; expect FAIL.
- [ ] Fetch current SMTP/library documentation before adding Node 24-compatible `nodemailer` and typings. Implement cookie parsing/serialization, same-origin checks and anonymous/session-bound double-submit CSRF hashes. Use one database transaction for consuming reset token, updating password and revoking sessions; concurrent use must lock and recheck. Keep verification/login/account forms on the frontend (Task 8), not HTML generated by mail endpoints. Links target fixed configured APP_URL, never request Host. Redact secrets, add no-referrer policy on token pages, and never log links. Configure ALLOWED_ORIGIN, APP_URL, SMTP_HOST/PORT/SECURE/USER/PASS/FROM; document serverless SMTP connectivity and production HTTPS requirements.
- [ ] Wire provisioning from Task 1 to verified activation/reset with actual delivery, no stdout token; test rollback/retry and duplicate claim safety. Run new tests plus `corepack pnpm --filter odi-bid-battle-api run typecheck`; expect PASS.
- [ ] Stage exact files and commit `feat: add account verification and password recovery`.

## Task 4: Google sign-in and explicit linking

**Files:** Create `api/src/auth-google.ts`, `api/test/auth-google.test.ts`; modify auth store/routes, API dependencies, lockfile and deployment documentation.

**Interfaces:** `mountGoogleAuth(app:express.Express, auth:AuthStore, config:GoogleAuthConfig):void`. `GET /auth/google/start` is login-only, `POST /auth/google/link` requires an existing session, CSRF and recent local reauthentication, and `GET /auth/google/callback` consumes the stored OAuth transaction. Add `POST /auth/reauthenticate {password}` for password accounts. Google-only identity relinking is not required in this scope. SessionView includes the required Google capability flag, not secrets.

- [ ] Write mocked OIDC tests for correct userinfo/ID-token validation, invalid issuer/audience/signature/nonce, expired/reused state, PKCE exchange failure, unverified email rejection, concurrent callback consumption, unique generated username, matching-email refusal and explicit linking after local reauthentication. Callback replay must not create another session or identity.
- [ ] Run `corepack pnpm --filter odi-bid-battle-api exec vitest run test/auth-google.test.ts`; expect FAIL.
- [ ] Fetch current `openid-client` documentation and use its OIDC flow rather than hand-rolled JWT verification. Configure only Google issuer, client ID/secret, fixed callback URL, openid/email/profile scopes. Persist a short-lived one-use state record bound to a browser transaction cookie, nonce, PKCE verifier and optional linking user/session. Encrypt recoverable PKCE verifier at rest with an environment-held AUTH_STATE_ENCRYPTION_KEY; store state hash only. Delete state on consumption/expiry. Persist issuer/subject mapping; do not persist Google access/refresh tokens. Linking requires reauthentication within five minutes. Matching-email sign-in returns an account-link instruction without silently taking ownership. Redirect only to validated same-origin paths.
- [ ] Run Google tests and API typecheck; expect PASS. Document GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI and AUTH_STATE_ENCRYPTION_KEY provisioning, rotation impact and exact callbacks for local/production.
- [ ] Stage exact files and commit `feat: add Google login with safe account linking`.

## Task 5: User-scoped repositories and complete API protection

**Files:** Create `api/src/access.ts`, `api/test/access.test.ts`; modify `store.ts`, battlefield/team/live stores and route modules, `app.ts`; update existing API route/store test fixtures.

**Interfaces:** `PgStore.forUser(userId:string):PgStore` returns a new immutable scope sharing only the pool; authenticated requests receive a scoped store, never mutate the singleton. Root PgStore without user scope may expose pool/auth/bootstrap only; domain operations fail closed. Subrepositories carry the same immutable userId. `AccessError` maps to 404 across route error translators. `assertOwnedAuction(client:Pool|PoolClient,id:string,userId:string):Promise<void>` supports transaction-local checks; list/candidate/battlefield own-write checks use equivalent owner predicates.

- [ ] Write two-user tests: unauthenticated domain API always 401, private GET/images/write/clone 404 for another user, body owner spoof ignored, only own auctions listed, cross-user teams/member uploads/flags/avatars/background/live/undo inaccessible, concurrent A/B calls on the same app/pool remain isolated. Test nested IDs where a valid team/upload belongs to a different auction.
- [ ] Run `corepack pnpm --filter odi-bid-battle-api exec vitest run test/access.test.ts`; expect FAIL against previously unprotected routes.
- [ ] Mount public health/auth routes before a mandatory session boundary; mount every domain route after it. Scope list/get/update/delete/insert SQL by actor, including queries inside existing transactions and lazy subrepositories. Never use a bare preflight owner check followed by an unconstrained write when the same transaction can enforce ownership. Add no-store for all authenticated responses. Replace route closures that cache `store.live`/`store.teams` globally with request-scoped access. Preserve body/image budgets and existing validation/error translation.
- [ ] Update every existing direct store caller/test to `.forUser(fixtureUser.id)` and route tests to the authenticated client; domain-only algorithm tests stay unchanged. Run all API tests and API typecheck; expect PASS. Validate SQL independently of in-memory doubles using the disposable real PostgreSQL fixture.
- [ ] Stage exact affected API paths and commit `feat: enforce ownership across application APIs`.

## Task 6: Shared libraries, contextual access and stable references

**Files:** Modify store/battlefield repositories, `access.ts`, `app.ts`, `battlefield-routes.ts`; create `api/test/sharing.test.ts`; extend candidate-identity and battlefield-store tests.

**Interfaces:** `listCandidates(includePublic=false)`, `listLists(includePublic=false)`, `battlefields.list(includePublic=false)` return own ∪ permitted public records with Visibility. Existing creation/editing methods accept a final `isPublic:boolean` argument defaulting false on create and preserving current value when omitted on edit. HTTP `includePublic=true` is strict string parsing. `GET /candidates/:id` and `/image` optionally accept exactly one `listId` or `auctionId` CandidateContext. Access requires that context itself is readable and includes the candidate. Entry add operations accept optional `sourceListId` only when selecting an entry of a readable public list; server revalidates membership.

- [ ] Write tests for default-only-own and include-public union, own public record deduplication, strict checkbox parsing, nonowner update/archive/reorder rejection, cloning readable lists to own private lists, forbidden foreign/private reference insertion and context ID forgery. Public-list/private-candidate contextual GET succeeds; raw candidate GET/image and unrelated contexts remain 404.
- [ ] Add tests `source_revocation_preserves_existing_reference_only`, `later_private_edit_is_not_visible_to_previous_consumer`, `foreign_list_draft_is_detached`, `foreign_candidate_edit_creates_own_private_copy`, and existing auction history image retention. A source catalog edit cannot change referenced rows in place. Public→private on a list cannot break a previously copied list/auction; new selections are denied.
- [ ] Run `corepack pnpm --filter odi-bid-battle-api exec vitest run test/sharing.test.ts test/candidate-identity.test.ts test/battlefield-store.test.ts`; expect FAIL for visibility/context support.
- [ ] Implement contextual reads using validated membership joins, not publicizing child records. Existing reference IDs grant only the version retained under ADR-0001; enforce copy-on-edit for every referenced candidate/battlefield version. Copy public foreign list membership at consumption time, detach foreign source tracking, and use existing battlefield auction override/snapshot columns to preserve selected version. Never grant global reads because a row is referenced somewhere. Root archive/private flags block new selection, not already-owned consumer graphs. Clone library roots with actor owner and is_public=false. Candidate library edits retain chosen visibility on replacement; editing another user's candidate through own context creates own private replacement without archiving the other user's original.
- [ ] Run targeted and full API tests plus typecheck; expect PASS. Review every resource DTO, image route and foreign-key input against the two-user matrix.
- [ ] Stage exact files and commit `feat: add opt-in library sharing and scoped references`.

## Task 7: Credentialed frontend transport

**Files:** Modify `web/src/api.ts` and image URL consumers; create `web/src/auth-api.ts`, `web/src/auth-api.test.ts`; update existing web API assertions/fixtures.

**Interfaces:** `apiRequest(path:string, init?:RequestInit):Promise<Response>` is the single checked credentialed fetch path; sends credentials and CSRF header on unsafe methods without setting a multipart Content-Type. `authApi.session/login/register/logout/forgotPassword/resetPassword/verifyEmail/resendVerification/reauthenticate/linkGoogle` correspond exactly to Task 3/4 endpoints. `setSessionCsrf(token:string):void`, `subscribeUnauthorized(listener:()=>void):()=>void` keep secrets only in memory. `api.candidates(includePublic=false)`, `api.lists(includePublic=false)`, `api.battlefields(includePublic=false)` and DTOs match Task 6. Candidate image/get URL helpers accept optional CandidateContext and preserve revision cache-busting parameters.

- [ ] Write fetch mock tests asserting credentials on all domain calls, CSRF on POST/PATCH/DELETE/FormData, no manual multipart boundary, 401 event emission, no sensitive state in localStorage, context URL encoding, default includePublic omitted and true explicitly included. Preserve existing 413 handling.
- [ ] Run `corepack pnpm --filter odi-bid-battle-web exec vitest run src/auth-api.test.ts`; expect FAIL.
- [ ] Implement transport once and migrate all fetch calls, retaining existing budget/error handling. Every image used through a list or auction passes its real context. Native image cookies require same-origin production API and same-site localhost development; do not put session tokens in URLs.
- [ ] Run all web tests and web typecheck; expect PASS after fixture updates.
- [ ] Stage exact files and commit `feat: add authenticated browser transport`.

## Task 8: Account UI and session boundary

**Files:** Create `web/src/auth.tsx`, `web/src/auth.test.ts`; modify `App.tsx`, `main.tsx`, `i18n.ts`, `design.css`/`app.css` and session transport only as needed.

**Interfaces:** `SessionBoundary({children}:{children:(user:AuthUser)=>React.ReactNode})` owns session loading and account view; protected workspace mounts keyed by `user.id`. `AccountScreen` handles login/register/forgot/reset/verify and explicit Google link/reauth state in one compact layout. Route states use `/account?mode=...`; protected `/app?tab=...` plus legacy `?tab=` deep links restore only safe internal destinations. Landing is Task 10.

- [ ] Write tests for route/state selection and post-login destination validation, reset token consumption in UI, session expiry, logout clearing workspace, and a delayed old-user API response after switching users remaining invisible. Use current Vitest patterns plus React server rendering where appropriate; browser verification is also mandatory (Task 11), do not add a new test framework merely for selectors.
- [ ] Run `corepack pnpm --filter odi-bid-battle-web exec vitest run src/auth.test.ts`; expect FAIL.
- [ ] Invoke applicable UI skills at execution time. Implement loading gate before any domain fetch; unmount protected app on 401/logout, cancel or ignore in-flight effects, clear selected draft/session state and in-memory CSRF. Account forms use proper autocomplete, labels, keyboard focus, generic errors, loading/disabled states, and SMTP/Google availability copy. Password input never echoes into URLs/logs. Existing Google-only accounts can set a local password through recovery. Strip URL tokens from address/history after capture and set no-referrer on sensitive pages.
- [ ] Add complete TR/EN strings. Run auth tests, all web tests and typecheck; expect PASS. Verify login/register toggles do not discard an already entered email unnecessarily.
- [ ] Stage exact files and commit `feat: add compact account screens and protected workspace`.

## Task 9: Ownership-aware library and selection controls

**Files:** Create `web/src/sharing.tsx`, `web/src/sharing.test.ts`; modify `App.tsx`, `battlefields.tsx`, relevant candidate/list/battlefield selectors in draft modules, `api.ts`, `i18n.ts`; update existing catalog/battlefield/auction tests.

**Interfaces:** `PublicFilter({checked,onChange,lang})` and `ShareField({checked,onChange,lang})` render accessible native checkboxes. Per-picker visibility state is local, defaults false, and never silently widens another picker. `canEdit(record:Visibility,userId:string):boolean` is strict owner equality, used for rendering only—not API security.

- [ ] Write tests `filter_defaults_private_and_is_independent`, `only_owner_gets_edit_controls`, `shared_copy_is_owned_and_private`, and `foreign_entry_edit_creates_private_copy`; assert API payload booleans for JSON and multipart. Include empty own catalog with public data available, revoked selections, and context image propagation.
- [ ] Run `corepack pnpm --filter odi-bid-battle-web exec vitest run src/sharing.test.ts`; expect FAIL.
- [ ] Add sharing checkbox to all three root create/edit flows and public inclusion checkbox to each library tab AND every relevant selection list. Distinguish shared records visually; hide nonowner root mutation actions while retaining selection/read and existing copy actions. Own list/auction contextual candidate editing follows Task 6 copy semantics. Auction draft/Divan/result selectors remain own-only with no public checkbox. Preserve archived references in current views even when absent from selection results.
- [ ] Run all web tests/typecheck; expect PASS. Inventory all create/edit/select controls in App and battlefields rather than updating only top-level tabs.
- [ ] Stage exact files and commit `feat: add private-by-default library sharing controls`.

## Task 10: Public animated landing page

**Files:** Create `web/src/landing.tsx`, `web/src/landing.css`, `web/src/landing.test.ts`, `web/public/landing/` with up to three captured demo screenshots; modify session boundary routing and i18n; modify `web/vercel.json` only if needed for SPA fallback.

**Interfaces:** `LandingPage({lang,onStart}:{lang:Lang;onStart:()=>void})` never fetches private data. Start goes to /app for a valid session, /account otherwise. Screenshots are committed static assets captured from synthetic fixtures, not private production records.

- [ ] Write tests for public route availability without domain calls, accessible CTA, TR/EN content, at most three lazy-loaded screenshot images with dimensions/alt, and reduced-motion/IntersectionObserver-unavailable fallback leaving content visible. Check SPA deep-link handling does not swallow /api 404.
- [ ] Run `corepack pnpm --filter odi-bid-battle-web exec vitest run src/landing.test.ts`; expect FAIL.
- [ ] Invoke UI and browser skills during execution. Build short hero, four-stage story, icon-led cards, screenshot-led cards and final CTA in the existing visual language. Capture real application screenshots using disposable synthetic demo users. Use IntersectionObserver reveals and one desktop sticky narrative, keyboard-equivalent focus interactions, mobile stacked layout, and prefers-reduced-motion disabling transforms/sticky motion. No animation dependency, scroll hijacking, private network calls, generated fake screenshots or user-data screenshots.
- [ ] Run landing tests, web tests/typecheck/build; expect PASS. Check direct navigation and refresh on /, /account, /app and Google callback. SPA fallback must come after /api handling.
- [ ] Stage exact files/assets and commit `feat: add public interactive landing page`.

## Task 11: End-to-end isolation, deployment readiness and final review

**Files:** Extend API/web tests above; finish `docs/auth-deployment.md`, sanitized environment examples, provisioning CLI scripts and test fixture documentation. No new feature modules.

**Interfaces:** Both entry points use the same strict configuration and security gates. Provisioning and migration are operator-triggered, never automatic on incoming HTTP requests.

- [ ] Add any missing regression from the Review Focus matrix; fail it before a repair. Inspect all HTTP methods, nested IDs and binary assets against the approved spec. Test mixed concurrent user traffic, hidden-source old versions, and expired session during an upload.
- [ ] Run `corepack pnpm run typecheck`, `corepack pnpm run test`, `corepack pnpm --filter odi-bid-battle-api run build`, `corepack pnpm --filter odi-bid-battle-web run build`, and `corepack pnpm --filter odi-bid-battle-api run verify-built-assets`. All must PASS; absent disposable DB or unavailable external service must be reported as unverified, not passing.
- [ ] Browser-check desktop/mobile registration→verification→login→logout, username/email login, recovery, two-user public/private matrices, every picker default, inaccessible copied IDs/images, landing scrolling/keyboard/reduced motion, and refresh/deep links. Real Google/SMTP checks require operator-provided config; mocks do not count as live verification.
- [ ] Document backup, disposable migration rehearsal, maintenance-window deployment, locked legacy claim, user-controlled secrets, SMTP rejection behavior, HTTPS/cache/CORS/proxy settings, scrypt timing/memory measurements, token expiry/cleanup and state encryption rotation. Old API must not be reachable during or after cutover. Do not deploy or touch production data without explicit authorization.
- [ ] Run a fresh independent whole-branch security/spec review after implementation. Fix blockers with regression tests; repeat affected checks. Stage exact final docs/test fixes and commit `test: verify authentication isolation and deployment readiness`.

## Self-review

- Spec coverage: identity/security Tasks 1–4; ownership and reference stability Tasks 5–6; API caller/image/DTO updates Task 7; account UX Task 8; all sharing controls Task 9; landing Task 10; production verification/documentation Task 11.
- Interfaces: Task 7/8 account methods correspond to Task 3/4 routes; root library Visibility and CandidateContext match Task 6; repositories use a single immutable forUser scope and explicit contextual reads.
- Five Review Focus conditions each have a named owning test. Migration is idempotent, legacy passwordless account stays locked until operator provisioning, and historical auctions remain private.
- No product code has been implemented by this plan. External provider setup, production deployment and actual credentials remain operator responsibilities.
