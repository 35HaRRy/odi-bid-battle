# Auction Drafts from Saved Candidate Lists — Design (Issue #3)

Date: 2026-09-10. Status: approved for implementation.
Scope: spec §2 + §3.2, design §3-4 (Auctions home, preparation entry). No start-lock, no bidding, no battlefield/teams full slices (#5, #6 own issues).

## Behavior

- Operator picks saved candidate list, creates named auction draft. Draft name user-authored, never translated.
- Home lists drafts/ongoing/completed with search, open/resume, create-from-list, rename, create-from-existing-record (clone prep info only — later issue, stub disabled).
- Draft follows source list (order + entries) until first local edit. First local edit = rename alone, add, remove, reorder, candidate edit. On fork: independent copy with all entries, `follows_source=false`. Copy stays even if edits undone; no auto-reconnect.
- Two untouched drafts on same list both follow reorder. After one forks, source edits affect only still-linked draft (scenarios 14, 16).
- Draft edits autosave. Reopen app resumes selected draft (`localStorage obb-selected-auction` + DB truth). Missing team/battlefield/image never blocks save; blocks only start (later issue).
- Offline: same local Postgres as #2. Persistence failure → error banner, never fake-saved.

## Architecture

- Postgres new tables (nullable placeholders until #5/#6):
  `auctions(id, name 0..200, source_list_id FK nullable SET NULL, follows_source BOOL, battlefield_id TEXT nullable no-FK, preparation JSONB '{}', status draft|ongoing|completed, created_at, updated_at)`,
  `auction_entries(auction_id CASCADE, candidate_id FK, position, PK(auction_id,candidate_id), UNIQUE(auction_id,position))`.
- Domain pure (`api/src/domain.ts`): `createAuctionDraft, renameDraft, forkDraftOnEdit, syncFollowedDraft, isDraftSaveable`. No IO.
- Store (`api/src/store.ts`): `saveAuction/getAuction/listAuctions/renameAuction/setAuctionEntries/setFollowState`. Errors → `PersistenceError`.
- API: `POST /auctions {name, sourceListId}`, `GET /auctions`, `GET /auctions/:id`, `PATCH /auctions/:id {name?, battlefieldId?}`, `POST /auctions/:id/entries`, `DELETE /auctions/:id/entries/:cid`, `POST /auctions/:id/reorder`. First entries/name mutation on following draft forks (copies source entries + applies edit).
- Web: Auctions tab enabled. Home + draft entry (step-2 list editor reused against draft copy). Debounced autosave. Draft name rendered raw.

## Validation / errors

- Save: always OK (empty name allowed as draft, missing refs allowed).
- Rename to blank while draft: allowed (stays draft). Non-draft rename blank → 400 (future).
- Duplicate candidate in draft copy → 409 + i18n duplicate string.
- DB down → 500 persistence failed → banner.

## i18n

- New keys: auctions, createDraft, openDraft, rename, draftName, resume, fromList, searchAuctions. TR default + EN. User content (draft/list/candidate names) never through `t()`.

## Tests

- `auction-domain.test.ts`, `auction-store.test.ts` (pg integration + failure unit), web `auctions.test.ts` + i18n extend.
- Typecheck per slice, full suite at end.

## Self-review

- No TBD. Consistent with ADR-0001 (copy-on-edit, fixed-at-start later). Single-plan scope. Fork trigger explicit (rename alone counts). Resume pointer explicit.
