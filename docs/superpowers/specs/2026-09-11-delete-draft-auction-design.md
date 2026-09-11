# Delete Draft Auction — Design

Date: 2026-09-11. Status: approved for implementation.
Scope: "Müzayedeler" tab, `status=draft` auctions only. No change to ongoing/completed, no soft-delete, no undo.

## Behavior

- Auctions list row shows "Sil" button only when `status === "draft"`. Ongoing/completed rows show no delete control (hidden, not disabled).
- Click "Sil" opens confirm dialog reusing archive pattern (title/text/Delete/Cancel). Confirm performs permanent delete.
- On success: row removed from list, `deleted` feedback; if deleted id is the open draft (`activeId` / `localStorage obb-selected-auction`), selection cleared and draft view falls back to empty + back-to-auctions.
- Search filter and counts update from remaining list. No undo path.

## Architecture

- Store (`api/src/store.ts`): `deleteDraftAuction(id): Promise<void>`. Reads `status` first; missing → `auction not found`; non-draft → `only drafts can be deleted`; else `DELETE FROM auctions WHERE id=$1`. Entries/teams/members removed via existing `ON DELETE CASCADE` (`auction_entries`, `auction_teams`, `auction_team_members`).
- API (`api/src/server.ts`): `DELETE /auctions/:id` → 204 on success. Error map: `auction not found` → 404, `only drafts can be deleted` → 409, `PersistenceError` → 500. Reuses existing `toHttp`.
- Web client (`web/src/api.ts`): `deleteAuction(id): Promise<void>` via `DELETE /auctions/:id`.
- Web UI (`web/src/App.tsx` Auctions home table): draft-only "Sil" in `record-actions`; local confirm state (`pendingDeleteId`); generic dialog reuse. Success path filters `setAuctions` and clears active selection.

## Validation / errors

- Missing id → 404 `auction not found` → banner `persistFail`.
- `status !== draft` → 409 (backend guard even though button hidden) → banner.
- DB failure → 500 → banner, list unchanged.
- Delete is not a fork trigger; `ensureForked` not involved.

## i18n

- New keys TR/EN: `delete` ("Sil"/"Delete"), `deleteDraftTitle` ("Taslağı sil?"/"Delete this draft?"), `deleteDraftText` ("Bu taslak kalıcı olarak silinecek. Bu işlem geri alınamaz."/"This draft will be permanently deleted. This cannot be undone."), `deleted` ("Taslak silindi."/"Draft deleted."). User content (auction names) never translated.

## Tests

- Store integration: draft with entries+teams deletes row + cascades; ongoing delete throws; missing throws.
- Route test: DELETE draft → 204 + GET → 404; DELETE ongoing → 409; DELETE missing → 404.
- Web test: draft row renders Sil, ongoing/completed rows render none; confirm → api called + row removed; cancel → no call.

## Self-review

- No TBD. Consistent with schema cascades and ADR-0001 (only drafts deletable, started history untouched). Single-plan scope. Hidden-button choice explicit; backend still enforces draft-only.
