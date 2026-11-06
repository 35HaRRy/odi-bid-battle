# Account services and shared chrome implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Restore local authentication prerequisites and unify branding/navigation across every page.
**Architecture:** Shared header/footer wrap SessionBoundary content; existing workspace menu remains in App. Existing schema is the only database migration source.
**Tech Stack:** React 18, TypeScript, CSS, Express, PostgreSQL, Vitest.
**Spec:** docs/superpowers/specs/2026-11-05-account-shell-design.md

## Global Constraints
- No dependencies, secret disclosure, production changes, legacy account claiming, or unrequested commits.
- Preserve existing user changes and existing data.

## Review Focus
- Anonymous, authenticated, loading, and logout-blocked routes all retain chrome.
- Long translated labels wrap between buttons, not within labels; small screens do not overflow.
- Language changes synchronize workspace and outer chrome.
- Missing authentication schema is detected locally; schema update does not delete existing data.
- SMTP rejection does not become a false registration success; native Google navigation remains protected by server-side state/PKCE.

### Task 1: Repair local schema prerequisites
Files: `db/schema.sql` (existing, execute only), `docs/auth-deployment.md`, `api/src/server.ts`, API tests if startup validation is needed.
- [x] Reproduce missing auth tables using read-only queries; inspect existing migration before applying.
- [x] Apply schema transaction to the verified local database; compare record counts and required tables.
- [x] Verify Google start produces a provider redirect; verify SMTP remains rejected without changing credentials.
- [x] Document local upgrade command and SMTP diagnosis.

### Task 2: Shared chrome and account controls
Files: create `web/src/site-chrome.tsx`, `web/src/site-chrome.test.ts`; modify `web/src/auth.tsx`, `web/src/auth.test.ts`, `web/src/App.tsx`, `web/src/landing.tsx`, CSS and i18n as needed.
- [x] Add failing render tests for brand, ordered social URLs, accessible avatar/language controls, compact account buttons and Google mark.
- [x] Run focused tests and confirm expected failures.
- [x] Implement shared chrome and icon buttons with existing primitives; remove duplicate headers/controls.
- [x] Run focused tests then full suites/typechecks and build.
- [x] Inspect desktop/mobile account, landing and workspace pages; fix confirmed defects in one batch.

### Task 3: Final verification and review
- [x] Review the full diff for data safety, preserved account actions, language synchronization and inaccessible/overflowing controls.
- [x] Run final tests/typechecks; record actual results and any limitations below.

## Execution ledger
- Working in the existing `feature/login` checkout: local dev services and uncommitted user package/lockfile changes are already here; no worktree was created without consent.
- Initial evidence: no auth tables in configured local database; SMTP `EAUTH`/535; Google discovery 200. Secrets were not printed.
- User approved shared chrome and local migration with “ilerle”. Tasks execute inline; no commits requested.
- Task 1 complete: custom-format local backup saved outside the repository as `odi-before-account-20261105.dump`. Schema applied twice; counts and digests of every previous row/column unchanged across 16 tables. Required auth tables verified. Real Google start responds 302 to accounts.google.com with transaction cookie. SMTP verify still EAUTH/535; no credentials modified, no email verification bypass.
- Task 2 complete: six new assertions failed before implementation, then passed; focused suite 37/37. Regression assertions are in existing `auth.test.ts` and `landing.test.ts`, rather than a separate chrome test file, to exercise the actual route owner. No startup checker needed: the existing schema and documented upgrade command resolve the root cause without new runtime behavior.
- Task 3 complete: frontend 132/132; API 310/310 on explicitly disposable UTF-8 database, run with `--fileParallelism=false --testTimeout=20000 --hookTimeout=20000`. Initial default-environment run failed for missing tables/connections; first parallel isolated run timed out. Serial isolated run passed all 26 API files. Disposable database removed afterward.
- Both TypeScript checks and secret-free programmatic Vite production build passed; `git diff --check` clean. Impeccable detector returned no findings for changed chrome/account components.
- Browser verification: 1440/390/320px Turkish/English registration, login/forgot navigation, mobile landing, 1440/320px authenticated workspace visual fixture, synchronized language controls. Single header/footer, loaded logo/Google assets and no horizontal/page/action overflow verified. At 320px avatar menu initially x=-23.4px; browser assertion failed, anchor changed to controls container, then assertion passed (menu x=50px..290px).
- Fresh read-only final review found no Critical/Important/Minor issues. Reviewer did not independently repeat database/provider/browser/tests; runtime evidence above is from this session. Live SMTP delivery and complete Google consent/callback remain unverified.
- Google font is a self-hosted 2.5KB WOFF2 subset for the two button labels, with license/provenance. No dependencies added. The package manager generated a root lockfile preamble during checks; only that generated preamble was removed, preserving all pre-existing package/lockfile modifications.
