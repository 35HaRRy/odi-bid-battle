# Issue #2 — Approach A build log (2-1789057335)

Stack: Vite + React + TS (web/) + Node API (api/) + Local Postgres (docker, 5433).
Scope: catalog + lists functional, other nav disabled placeholder.
Spec: docs/odi-bid-battle-spec.md §2 + §3.1. Design: docs/odi-bid-battle-design.md §3-4.
Seams (TDD): domain pure (dedup/reorder/draft) + store (persist/rehydrate PG, failure→error).

## Decisions
- Local Postgres via docker-compose (port 5433; 5432 taken by api-postgres-1).
- Images → bytea + mime + original name (app-owned copy).
- i18n TR default + EN, user content untranslated, pref in localStorage.
- Entries unique(list_id, candidate_id); archive not delete.

## Slices
1. domain red→green (vitest)
2. store red→green (pg integration on 5433 + failure unit)
3. api REST + web UI catalog/lists + i18n
4. typecheck + full suite + code-review + commit development + comment gh#2
