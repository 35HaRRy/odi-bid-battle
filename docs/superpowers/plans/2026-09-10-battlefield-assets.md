# Battlefield Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ask the operator which execution mode to use. Work on the current branch as requested; do not create a worktree.

**Goal:** Implement issue #5 battlefield management, preserved references, draft selection, and locally stored initial backgrounds.

**Architecture:** Add a focused battlefield domain module and a transactional PostgreSQL asset repository exposed through `PgStore`. Mount dedicated asset routes in the existing Express application. Compose focused React library/editor/preparation components into the existing atlas application.

**Tech Stack:** TypeScript, PostgreSQL (`pg`), Express 4, Multer, React 18, Vite 5, Vitest 2. Use native `fetch` for HTTP integration tests and the browser verification tools for interactive UI checks.

## Global Constraints

- Approved source: `docs/superpowers/specs/2026-09-10-battlefield-assets-design.md`.
- Editing a referenced battlefield creates a copy and archives the original atomically. Existing references never move automatically.
- Geography and history are single user-authored strings; never translate them.
- Turkish is the default interface language; English labels and validation are also supported.
- Uploads follow the existing 5 MB limit; invalid or unsupported images produce actionable validation errors.
- A bundled local parchment image supplies the default for every draft without an override.
- Battlefield selection and background changes save immediately and do not fork the candidate list.
- Reject presentation-asset changes for non-draft auctions.
- Incomplete drafts can retain no battlefield.
- Live halfway transitions and final-screen panels are deferred to issue #12. Do not claim their acceptance criteria passed or close issue #5 as fully implemented.
- Use the approved atlas layout and full, uncropped images. Check keyboard operation and narrow screens.
- Run single test files and typechecking during implementation; run the full test suite once at the end. Run the requested code-review workflow, address findings, and commit to the current branch.

## File map and ownership

| File | Responsibility |
| --- | --- |
| `api/src/battlefield-domain.ts` | Field validation, supported image policy, asset error codes |
| `api/src/battlefield-store.ts` | Transactional battlefield and draft-image persistence |
| `api/src/battlefield-routes.ts` | Multipart parsing, metadata/image responses, asset error mapping |
| `api/src/assets/default-background.svg` | Bundled parchment artwork without external resources |
| `api/src/store.ts` | Own repository instance; delegate existing battlefield-selection method |
| `api/src/server.ts` | Mount asset routes and preserve existing application routes |
| `db/schema.sql` | Idempotent battlefield schema and auction asset migration |
| `api/test/battlefield-domain.test.ts` | Validation tests |
| `api/test/battlefield-store.test.ts` | Database persistence, locking, and rollback tests |
| `api/test/battlefield-routes.test.ts` | Real multipart/HTTP integration tests |
| `web/src/battlefields.tsx` | Library, editor, selected battlefield preview, preparation assets |
| `web/src/api.ts` | Battlefield metadata and upload client contracts |
| `web/src/App.tsx` | Enable library navigation and draft steps 1/2 |
| `web/src/i18n.ts` | Turkish/English labels, validation, errors, save status |
| `web/src/app.css` | Focused atlas-compatible responsive layout additions |
| `web/src/battlefields.test.ts` | Fetch-client request/error and localization checks |
| `scripts/verify-battlefields.mjs` | Browser flow covering library, selection, uploads, reload, and layouts |

Existing `web/src/design.css` provides `.battle-library`, `.battle-entry`, `.battle-layout`, `.battle-option`, and `.map-wrap`. Inspect the prototype files under `.superpowers/brainstorm/49-1789040875/content/` directly; normal glob searches can omit this ignored directory. Existing auction tests do not use Supertest or a DOM test environment. Do not copy the tautological selected-pointer test.

## Task 1: Define validated battlefield inputs

**Files:** Create `api/src/battlefield-domain.ts` and `api/test/battlefield-domain.test.ts`.

**Interfaces:**

```ts
export interface BattlefieldFields {
  name: string;
  geography: string;
  history: string;
}
export interface AssetImage {
  buffer: Buffer;
  mime: string;
  name: string;
}
export type AssetErrorCode =
  | "invalid name" | "invalid geography" | "invalid history"
  | "image required" | "invalid image" | "image too large"
  | "battlefield not found" | "battlefield archived"
  | "auction not found" | "preparation locked";
export class AssetError extends Error {
  constructor(public readonly code: AssetErrorCode) { super(code); }
}
export function validateBattlefield(fields: BattlefieldFields): BattlefieldFields;
export function validateAssetImage(image: AssetImage): AssetImage;
```

- [ ] Write red tests for trimming all strings, whitespace-only fields, a name over 200 characters, empty bytes, oversized bytes, unsupported MIME, and mismatched image headers. Use real minimal PNG/GIF fixtures rather than `Buffer.from([1])`.

```ts
it("rejects blank geography independently of the name", () => {
  expect(() => validateBattlefield({
    name: "Pelennor", geography: "   ", history: "An ancient field",
  })).toThrow("invalid geography");
});
it("retains user-authored text while trimming surrounding whitespace", () => {
  expect(validateBattlefield({
    name: " Pelennor ", geography: " Doğu sınırı ", history: " Eski çağ ",
  })).toEqual({ name: "Pelennor", geography: "Doğu sınırı", history: "Eski çağ" });
});
```

- [ ] Run `npm run test -w api -- test/battlefield-domain.test.ts`; expect failure because the module does not exist.
- [ ] Implement validation. Trim each string; reject missing/non-string/empty fields with the matching code, and names exceeding 200 characters. Accept PNG, JPEG, GIF, and WebP uploads with matching signatures only; reject SVG uploads while allowing the trusted bundled SVG default. Enforce `buffer.length > 0` and `buffer.length <= 5 * 1024 * 1024`. The image policy must be the same for battlefield and background uploads.
- [ ] Run the same test file; expect all validation cases to pass. Run `npm run typecheck -w api`.

## Task 2: Persist battlefield identity atomically

**Files:** Create `api/src/battlefield-store.ts`, `api/test/battlefield-store.test.ts`; modify `api/src/store.ts` and `db/schema.sql`.

**Interfaces:** `BattlefieldStore` takes a real `Pool` shared by `PgStore`; it does not own pool shutdown. Export these contracts:

```ts
export interface BattlefieldRecord extends BattlefieldFields {
  id: string;
  archivedAt: string | null;
  image: AssetImage;
}
export type BattlefieldSummary = Omit<BattlefieldRecord, "image">;
// BattlefieldStore methods:
// create(fields: BattlefieldFields, image: AssetImage): Promise<BattlefieldRecord>
// list(): Promise<BattlefieldSummary[]>
// get(id: string): Promise<BattlefieldRecord>
// edit(id: string, fields: BattlefieldFields, image: AssetImage | null): Promise<BattlefieldRecord>
// archive(id: string): Promise<void>
// select(auctionId: string, battlefieldId: string | null): Promise<void>
// setBackground(auctionId: string, image: AssetImage | null): Promise<void>
// getBackground(auctionId: string): Promise<AssetImage | null>
```

- [ ] Write an integration test that creates a battlefield, selects it in two drafts, edits it, and verifies both drafts still reference the archived original. Add an unreferenced edit test where identity is unchanged. Run the test file and observe the missing implementation failure.

```ts
const original = await assets.create(fields, image);
await assets.select(draft1.id, original.id);
await assets.select(draft2.id, original.id);
const replacement = await assets.edit(original.id, { ...fields, name: "Revised" }, null);
expect(replacement.id).not.toBe(original.id);
expect((await store.getAuction(draft1.id)).battlefieldId).toBe(original.id);
expect((await store.getAuction(draft2.id)).battlefieldId).toBe(original.id);
expect((await assets.get(original.id)).archivedAt).not.toBeNull();
expect((await assets.get(replacement.id)).image.buffer).toEqual(image.buffer);
```

- [ ] Add the battlefield schema before the auction definition, then append a transaction-safe, idempotent migration for existing databases:

```sql
CREATE TABLE IF NOT EXISTS battlefields (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  geography TEXT NOT NULL CHECK (char_length(btrim(geography)) > 0),
  history TEXT NOT NULL CHECK (char_length(btrim(history)) > 0),
  image BYTEA NOT NULL CHECK (octet_length(image) > 0),
  image_mime TEXT NOT NULL,
  image_name TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_image BYTEA;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_mime TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_name TEXT;
```

For the foreign key, inspect `pg_constraint` by constraint name and table OID. If absent, check for non-null identifiers missing from `battlefields` and raise an exception listing the IDs. Otherwise add `auctions_battlefield_id_fkey REFERENCES battlefields(id)` with restrictive deletion. Add an index on `auctions(battlefield_id)`. Never clear dangling identifiers or reset the database to get the migration to pass.

- [ ] Implement repository SQL with parameterized queries and a transaction helper using one checked-out `PoolClient` throughout each mutation. Always roll back on failure and release in `finally`. Preserve `AssetError`; wrap infrastructure errors in existing `PersistenceError` at the `PgStore` boundary to avoid circular imports.
- [ ] In `edit`, lock the battlefield row `FOR UPDATE`, reject missing/archived rows, check `EXISTS(SELECT 1 FROM auctions WHERE battlefield_id=$1)`, and either update in place or insert the replacement and archive the original within the same transaction. Keep existing image bytes if the replacement upload is null. Return the committed record.
- [ ] Selection and archiving also lock the battlefield row, serializing them with edits. Use battlefield-first then auction-row locking consistently. Validate draft status inside the transaction. Selecting the already-selected archived ID is an allowed no-op; selecting a different archived ID is rejected. Clearing selects null. No selection path invokes candidate-list forking.
- [ ] Add tests for archived list filtering versus direct retrieval, unknown IDs, failed copy rollback, unchanged follow-state/entries, null selection, non-draft rejection, and selecting an archived record from another draft. Use an isolated test schema or clean up only records created by the test; never truncate shared tables.
- [ ] Verify rollback with a temporary PostgreSQL trigger in the isolated schema that raises on archiving: force the second half of referenced edit to fail, then assert no replacement survives and the original remains active.
- [ ] Apply schema with `npm run db:up`, then `npm run db:migrate`; repeat migration to verify idempotence. Run `npm run test -w api -- test/battlefield-store.test.ts`, then `npm run typecheck -w api`.

## Task 3: Draft background storage and HTTP assets

**Files:** Create `api/src/battlefield-routes.ts`, `api/src/assets/default-background.svg`, `api/test/battlefield-routes.test.ts`; modify `api/src/server.ts` and extend Task 2 tests.

**Interfaces:** `mountBattlefieldRoutes(app: express.Express, store: PgStore): void`. Expose `store.battlefields` as the focused repository. Existing `setAuctionBattlefield` delegates to validated selection and returns the existing `AuctionRecord` shape.

| Method and path | Request | Response |
| --- | --- | --- |
| `POST /battlefields` | Multipart name, geography, history, image | 201 `BattlefieldSummary` |
| `GET /battlefields` | None | Active `BattlefieldSummary[]` |
| `GET /battlefields/:id` | None | Summary, including archived records |
| `GET /battlefields/:id/image` | None | Image bytes and validated MIME |
| `POST /battlefields/:id/edit` | Multipart fields, optional image | Replacement/current summary |
| `POST /battlefields/:id/archive` | None | `{ok:true}` |
| `PATCH /auctions/:id` | `{battlefieldId: string|null}` | Existing auction response |
| `POST /auctions/:id/background` | Multipart image | `{ok:true}` |
| `DELETE /auctions/:id/background` | None | `{ok:true}` |
| `GET /auctions/:id/background` | None | Override/default image bytes |

- [ ] Write failing request tests using `buildApp(store).listen(0, "127.0.0.1")`, a resolved base URL from the listening address, native `fetch`, `FormData`, and `Blob`. Close the server and store in cleanup. Test valid upload/read-byte equality, missing fields, unsupported image, over-limit upload, missing ID, and locked draft.

```ts
const body = new FormData();
body.set("name", "Pelennor");
body.set("geography", "Eastern fields");
body.set("history", "Ancient roads");
body.set("image", new Blob([png], { type: "image/png" }), "field.png");
const response = await fetch(`${base}/battlefields`, { method: "POST", body });
expect(response.status).toBe(201);
const created = await response.json();
const savedImage = await fetch(`${base}/battlefields/${created.id}/image`);
expect(Buffer.from(await savedImage.arrayBuffer())).toEqual(png);
```

- [ ] Run `npm run test -w api -- test/battlefield-routes.test.ts`; expect route failures.
- [ ] Implement background storage by locking the auction row, rejecting missing/non-draft records, and updating all three background columns together. Null resets all columns. `getBackground` checks auction existence, returns an owned copy of stored bytes or null, and never mutates state. Add reopen and two-draft independence tests.
- [ ] Add the trusted bundled background artwork:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <rect width="1600" height="900" fill="#f2e7cf"/>
  <rect x="28" y="28" width="1544" height="844" rx="3" fill="none" stroke="#b4a07b" stroke-width="2"/>
  <path d="M48 450H1552M800 48V852" stroke="#b4a07b" opacity=".2"/>
  <circle cx="800" cy="450" r="250" fill="none" stroke="#b4a07b" opacity=".25"/>
</svg>
```

Load through a module-relative URL. Ensure the API build copies the asset into `dist/src/assets/`, using a cross-platform Node build-copy command rather than relying on the working directory. Test both development and built-server asset availability.
- [ ] Implement the route table with metadata serialization that omits bytes. Use request-scoped upload middleware with the 5 MB cap and explicit JSON errors for Multer failures. Map field/image validation to 400, too-large uploads to 413, unknown records to 404, archived-new-selection/locked-preparation to 409, persistence failures to 500. Add `Cache-Control: no-store` to mutable asset responses so edits/replacements are immediately visible; send `X-Content-Type-Options: nosniff` with images.
- [ ] Extend the existing auction PATCH error mapping for `AssetError`; keep its response shape. Never let the old unchecked battlefield setter bypass the repository. Verify battlefield-only PATCH does not call `renameAuction` or fork a list.
- [ ] Run the routes test file, the updated store test file, `npm run typecheck -w api`, and `npm run build -w api`. Expected: passing tests/types/build and bundled asset present at runtime.

## Task 4: Web client and atlas battlefield library

**Files:** Modify `web/src/api.ts`, `web/src/i18n.ts`, `web/src/App.tsx`, `web/src/app.css`; create `web/src/battlefields.tsx`, `web/src/battlefields.test.ts`.

**Interfaces:**

```ts
export interface Battlefield {
  id: string;
  name: string;
  geography: string;
  history: string;
  archivedAt: string | null;
}
export type BattlefieldInput = Pick<Battlefield, "name" | "geography" | "history">;
// api additions:
// battlefields(): Promise<Battlefield[]>
// getBattlefield(id: string): Promise<Battlefield>
// createBattlefield(fields: BattlefieldInput, file: File): Promise<Battlefield>
// editBattlefield(id: string, fields: BattlefieldInput, file: File | null): Promise<Battlefield>
// archiveBattlefield(id: string): Promise<void>
// selectBattlefield(auctionId: string, id: string | null): Promise<Auction>
// setAuctionBackground(auctionId: string, file: File): Promise<void>
// clearAuctionBackground(auctionId: string): Promise<void>
// battlefieldImageUrl(id: string): string
// auctionBackgroundUrl(auctionId: string): string
```

- [ ] Add failing client tests using `vi.stubGlobal("fetch", vi.fn())`, restoring globals after each test. Assert actual method, URL, multipart values, optional image omission, null-selection JSON, and preserved `ApiError.status`/message on 400/409/413/500.

```ts
const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(record)));
vi.stubGlobal("fetch", fetchMock);
await api.editBattlefield("field-1", fields, null);
const [url, init] = fetchMock.mock.calls[0];
expect(url).toContain("/battlefields/field-1/edit");
expect(init.method).toBe("POST");
expect(init.body.get("geography")).toBe(fields.geography);
expect(init.body.has("image")).toBe(false);
```

- [ ] Run `npm run test -w web -- src/battlefields.test.ts`; expect missing-client failures. Implement the client contracts above using existing `check` and `ApiError`. Do not add binary fields to the auction JSON response.
- [ ] Add TR/EN keys: battlefield intro/name/image, geography, history, new/edit battlefield, no battlefields, select/selected/clear selection, archived selection, initial background, change/reset background, next/back, loading/saving/saved, required name/geography/history/image, unsupported image, image too large, preparation locked, load failure, and save failure. Map server codes explicitly. Keep user content raw.
- [ ] Implement `BattlefieldLibrary({lang})`, `BattlefieldEditor({lang, initial, onSave, onClose})`, and `BattlefieldPreview({lang, battlefield})` in the focused module. Library owns loading, editor selection, archive confirmation, and refresh state. Re-fetch active records after edit because the returned ID may change. Directly render archived selected records only in preparation, not in the active library.

Use the approved markup shape:

```tsx
<div className="battle-library">
  {records.map((battlefield) => (
    <section className="battle-entry" key={battlefield.id}>
      <img src={api.battlefieldImageUrl(battlefield.id)} alt={battlefield.name} />
      <h3>{battlefield.name}</h3>
      <p>{battlefield.geography}</p>
      <div className="battle-entry-actions">
        <button className="secondary small-btn" onClick={() => setEditing(battlefield)}>
          {t(lang, "edit")}
        </button>
        <button className="quiet" onClick={() => setArchiving(battlefield)}>
          {t(lang, "archive")}
        </button>
      </div>
    </section>
  ))}
</div>
```

- [ ] Use a real modal dialog (`showModal`), labelled fields, keyboard cancellation, restored focus, a contained image preview, and pending-submit disabling. Create object URLs for new file previews and revoke them on replacement/unmount. Failed saves retain the modal and values with an error inside the modal. Archive failures retain the record and offer retry.
- [ ] Enable `Tab = ... | "battlefields"`, add the active navigation button, and render `BattlefieldLibrary` in the main route switch. Do not reroute library visits through `AuctionWorkspace`.
- [ ] Add responsive layout helpers scoped to battlefield components, preserving existing tokens. Ensure long names/history wrap with `overflow-wrap:anywhere`, text preserves line breaks, library cards stack at narrow widths, and images use `object-fit:contain`.
- [ ] Run client/localization tests and `npm run typecheck -w web`.

## Task 5: Draft battlefield step and initial background controls

**Files:** Extend `web/src/battlefields.tsx`; modify `web/src/App.tsx`, `web/src/app.css`; extend `web/src/battlefields.test.ts`.

**Interface:** `BattlefieldPreparation({lang, auction, onAuctionChange})` consumes an `Auction` and calls `onAuctionChange(updated: Auction)` only after persisted selection success. Background mutations own a local preview revision without replacing unrelated auction state.

- [ ] Add client tests for selecting null, accepting persisted selection, failed background uploads, and reset requests. Run the web test file before implementing missing client behavior.
- [ ] Implement preparation loading with active battlefield summaries and a separate direct lookup for the selected ID when absent from the active list. Cancel/ignore stale responses after auction changes. Never clear a selected archived reference merely because the active list omits it.
- [ ] Render `.battle-layout` with `.battle-option` buttons (`aria-pressed`), selected full-image `.map-wrap`, raw name/geography/history, an archived marker, and explicit clear selection. Disable mutations while saving and on non-draft records. Show load versus save errors separately.

```tsx
<button
  className="battle-option"
  aria-pressed={auction.battlefieldId === battlefield.id}
  disabled={pending || auction.status !== "draft"}
  onClick={() => select(battlefield.id)}
>
  <strong>{battlefield.name}</strong>
  <span>{battlefield.geography}</span>
</button>
```

- [ ] Render the resolved background URL for every draft, even with no override. Add labelled upload and reset controls. After successful upload/reset, increment a cache-busting preview revision; after failure keep the selected upload available to retry. Avoid optimistic saved labels. Add clear, localized pending/success/error feedback.
- [ ] Update `Steps` to accept current step and an `onSelect` callback for steps 0/1; retain disabled steps 2/3. Add back/next controls, default new drafts to battlefield step, and retain candidate list behavior in step 1. Key preparation by auction ID so uploaded files and pending state do not leak across drafts. Keep the list editor mounted or preserve its state intentionally when switching steps.
- [ ] Refresh auction data when reopening a draft. Update only the returned auction in the workspace array. A battlefield or background change must not rename the auction, copy its list, or clear entries. Verify switching language preserves the selected battlefield and raw content.
- [ ] Run `npm run test -w web -- src/battlefields.test.ts`, `npm run typecheck -w web`, and `npm run typecheck -w api`.

## Task 6: Browser acceptance, review, and commit

**Files:** Create `scripts/verify-battlefields.mjs`; update the approved design status and plan checkboxes after implementation verification. Add only intended source/test/docs files to commits.

- [ ] Use the browser skill/tooling already installed in the workspace. Start local database, API, and web with their existing scripts. Verify tooling/package availability before writing the script; use an installed Playwright browser API or the CLI skill's supported session commands, without introducing an application runtime dependency.
- [ ] Drive this end-to-end sequence with assertions and screenshots: create a battlefield with a real image; reopen and edit it unreferenced; create two drafts; select the battlefield in both; edit the now-referenced battlefield; verify replacement appears in library while both drafts retain the old name/image; archive the replacement; verify it disappears from new choices; replace one draft background; reload and compare preview; verify the other draft still has default; reset the first; clear selection and reload; switch TR/EN without translating authored text.
- [ ] Test failure recovery with a blocked or failed save request: editor remains open, entered text remains, error is visible, retry succeeds, and only one record is created. Verify Escape closes dialogs and focus returns. Check step navigation does not change list entries/follow state.
- [ ] At 390 px and 1280 px, assert document `scrollWidth <= clientWidth`, map images are contained, controls are reachable, and no page errors occur. Capture library, editor, and draft asset screenshots. A minimal overflow assertion is:

```js
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth
);
if (overflow) throw new Error("Horizontal document overflow");
```

- [ ] Run final `npm run typecheck`, `npm run build -w api`, and `npm run build -w web`.
- [ ] Run full `npm run test` once after all implementation changes. Record counts and any environmental blockers honestly. Do not substitute skipped database tests for passing persistence verification.
- [ ] Invoke `/code-review` against implementation changes since `ab7267c`; provide issue #5, the approved scope deferral, and written spec as the specification. Follow its standards/spec review workflow. Fix substantive findings and rerun relevant tests/types; repeat the full suite only if new changes or unresolved concerns justify it.
- [ ] Inspect `git status`, `git diff`, and `git log --oneline -10`. Run `git diff --check`. Stage only intended battlefield files and commit to the current branch with `feat: add preserved battlefield assets` and body `Refs #5; live/final presentation remains deferred to #12.` Do not push or close the issue.
- [ ] Report commit SHA, implemented behavior, exact verification results, and deferred live/final criteria.

## Plan self-review

- Spec coverage: validation/identity (Tasks 1–2), local/default assets and APIs (Task 3), atlas library (Task 4), draft controls and recovery (Task 5), accessibility/responsiveness/testing/review (Task 6).
- Interfaces use `BattlefieldFields`/`AssetImage` for server inputs, `BattlefieldSummary` for JSON, and `Battlefield` for equivalent web metadata. Auction JSON shape stays compatible.
- No uncontrolled candidate-list refactor or new live auction engine. Atomic copy-on-edit and selection locking are explicit. Deferred criteria are not counted as implemented.
- API tests use actual HTTP requests; web client tests examine request behavior; browser checks cover rendered user flows. Existing translation-only tests are not represented as UI coverage.
