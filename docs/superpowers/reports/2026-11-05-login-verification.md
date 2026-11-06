# Login and sharing — verification and handoff

Branch: `feature/login`, based on `development` at `edf99d5`.
Product HEAD reviewed and verified: `0905e283081a80109926a6d1c076f0fecafcf0f7`.
Spec: [approved design](../specs/2026-11-03-user-auth-and-sharing-design.md).
Deployment: [operator runbook](../../auth-deployment.md).

## Outcome

Implemented username/email + password and Google authentication, compact bilingual account forms, verification and password recovery, hash-only credential/session/token storage, mandatory API authentication, per-user ownership, opt-in library sharing and contextual immutable references, own-only auctions/live/results, and an interactive public landing page with three synthetic real-application captures.

Eleven tasks received implementation/review gates. Whole-branch review found seven issues, including executable candidate assets, tab CSRF invalidation and preparation/membership races. A consolidated fix wave addressed all seven. Independent scoped re-review approved the repairs with no remaining Critical/Important findings and one nonblocking UI issue below.

## Fresh final verification

Controller independently reran after final product commits, 2026-11-05, Node **24.22.2**:

| Check | Result |
|---|---|
| Full API, real disposable PostgreSQL 18 | **310 passed, 26 files; zero failures/skips** |
| Full web | **126 passed, 14 files; zero failures/skips** |
| API + web typecheck | PASS |
| API build and bundled asset validation | PASS |
| Production web build | PASS; 52 modules, JS 285.01 kB / 84.27 gzip |

Tests used isolated random UTF-8 databases/schemas on a loopback-only disposable cluster, never the application database. Vite/Vitest final checks explicitly disabled environment-file loading; normal `pnpm` replaced unavailable `corepack`. Temporary runner emitted Node DEP0190 and build helper emitted Vite CJS deprecation warnings; neither was a failed check. Prior early default test invocations may have implicitly loaded local environment files; no contents were opened/printed/copied and all database traffic was explicitly redirected to disposable databases. This caveat is not erased by the safe final reruns.

Reported browser evidence: actual React/Express/PostgreSQL synthetic accounts, controlled in-memory verification/reset mail, real cookie login, separate users, independent public filters, contextual asset access and historical retention, expiry/logout, mobile/reduced motion, safe deep links, and two actual tabs sharing cookies. Google tests use real OIDC validation with signed controlled protocol responses; they are not real Google consent.

## Decisions made during execution, in order

1. **Use the requested `feature/login` branch in the current checkout**, rather than an additional unnamed worktree. This honors the user's workspace choice; cost if wrong is reduced filesystem isolation. No unrelated work was overwritten.
2. **Use the native default general subagent, without explicit model overrides.** The tool contract requires a user-requested model before selecting one; cost if wrong is different dispatch efficiency, not product behavior.
3. **Use installed pnpm and explicitly selected Node 24**, because corepack is absent and global Node is 26. Cost if wrong is a toolchain mismatch; final outputs confirm Node 24 and the checked-in dependencies.
4. **Do not launch Docker Desktop, provision cloud services, or use existing environment credentials.** Use only a disposable local PostgreSQL for execution. Cost is extra local setup and no proof against production infrastructure.
5. **Provide contextual single-child insertion into an existing owned list.** The approved spec requires it; the earlier whole-list-only UI interpretation was incomplete. Cost is one small target selector/action and regression coverage.
6. **Keep live-provider/deployed-environment checks as operator release gates.** No external account or deployment authorization was supplied. Cost is that local verification is not permission to ship.
7. **Park the final nonblocking retained-source UI issue**, rather than open a second final fix wave. The workflow permits one final consolidated wave/re-review; cost is the reproducible detail-panel issue described below, not data loss or access bypass.

Preflight implementation sequencing also deferred the legacy invitation CLI until actual mail delivery existed; kept immutable actor scope/auth middleware fail-closed while older fixtures were adapted; reused existing immutable version IDs for historical grants; and preserved one final review rather than duplicate broad reviewer seats. No temporary production authentication bypass or owner default was used.

## Remaining limitation

After adding a candidate from a foreign public list into an owned list, switching off **Include public records** can hide the currently selected source's details. The target write succeeds and no data is lost; re-enable/reselect the source to view it again. Root cause: contextual insertion reuses `mutate`, which updates `retainedList` to the target while the active source remains unchanged (`web/src/App.tsx`, contextual-add callback). This was classified Minor by final re-review and is explicitly not claimed fixed.

Legacy unsupported image bytes are preserved but served as inert downloads, not inline previews. Existing tabs need a one-time reload after the CSRF upgrade. Serverless memory/capacity measurements are local only.

## Not performed / release gates

- No push, merge, deployment, real database migration, real legacy account claim, or production backup/restore.
- Live Google consent/callback and actual SMTP provider/inbox delivery remain unverified.
- Deployed Vercel ingress, proxy trust/IP attribution, HTTPS/cache/security headers, native production cookies, and serverless sizing require operator verification.
- Firefox/WebKit and an external accessibility audit were not performed; unrelated unchanged game algorithms were not exhaustively re-proved.

Follow the operator runbook before rollout: backup/rehearsal, maintenance window with old API inaccessible, transactional migration, validated secrets and callbacks, explicit locked-legacy claim, and live checks. The code does not automatically migrate or provision accounts on HTTP startup.
