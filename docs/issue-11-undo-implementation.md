# Issue #11: Undo Auction Actions - Implementation Summary

## Objective
Implement strict reverse-order undo for live auction actions (presentation, confirmed bid, skip, sale, termination) per spec section 8 and design section 4.

## Accepted Design Choice
- Restore unconfirmed draft fields alongside confirmed actions
- Use persisted pre-action snapshots atomically via shared transaction worker
- `canUndo` UI only enabled when history exists

## Implementation

### Backend
**Files Modified:**
- `db/schema.sql` - Added `auction_live_history` table with JSONB snapshot and FK cascade
- `api/src/live-store.ts` - Core undo implementation
- `api/src/store.ts` - Handler proxy for undo
- `api/src/live-routes.ts` - HTTP endpoint

**Key Changes:**
1. `LiveView` interface: Added `canUndo` boolean field
2. `LiveHistorySnapshot` interface: Captures status, cursor, active, activeCandidateId, turn, specialPass, latestTeam, latestAmount, contributions, latestRows, skipped, balances, acquired
3. Shared transaction worker: Atomic history and effect commit/rollback via `LiveStore(this.pool, client?)`
4. `undo()` method: Reverse restore of one snapshot, deletes snapshot entry after restore
5. `confirmBid()`, `sell()`, `pass()`, `endAuction()`: All capture and store optional `LiveHistorySnapshot` after successful action
6. `getLive()`: Computes `canUndo` based on history existence per action
7. `sendNext()` accepts optional `drafts` (unused at call sites per user ack)

 **HTTP Endpoint:**
- `POST /auctions/:id/live/undo` - Single action undo with exact restoration

### Frontend
**Files Modified:**
- `web/src/api.ts` - Added `undoLiveAction()` and `canUndo` to `LiveState`
- `web/src/live-council.tsx` - Undo button UI, state management
- `web/src/live-council.test.ts` - Unit tests
- `web/src/i18n.ts` - Translations (undo, firstHalf, secondHalf, undoDone, nothingToUndo)

**Key Changes:**
1. Undo button in council header, enabled only when `live.canUndo === true`
2. `undoLastAction()` function calls `api.undoLiveAction()`
3. Live half display: "First half" / "Second half" based on cursor position
4. Drafts propagation to pass/sale/bids for exact pre-action state restoration

### Tests
**API Tests (`api/test/live-store.test.ts`):**
- Undo restores sale drafts and exact refunds only after undoing later presentation
- Undo restores halfway skip, transferred opening drafts, and permanent preparation lock
- Undo termination restores only ready-to-end state across reconnects
- Scenarios 5, 10+18, 8 cover full round and transfer/termination flows

**HTTP Tests (`api/test/live-routes.test.ts`):**
- Undo over HTTP restores drafts and rejects invalid actions without adding history

**Frontend Tests (`web/src/live-council.test.ts`):**
- API integration tests for undo, confirmBid, passCandidate, completeSale
- i18n label existence tests

All test suites pass (API: 173 tests, Web: 29 tests).

## Verification

### Type Checking
- TypeScript compilation passes for both API and Web

### Prototype
- Atlas-style council header with Undo button in the right-side tools area
- Half-label display (First/Second half)
- Disabled state when no history exists

### Flow Coverage
1. **Presentation (sendNext) undo**: Should restore to bottom of previous round
2. **Confirmed bid undo**: Should revert bid, grant draft refunds, close round
3. **Skip (pass) undo**: Should restore to previous cursor with active candidate
4. **Sale undo**: Should revert sale, unwind confirmed transfers, restore draft refunds
5. **Termination undo**: Should restore to ready-to-end boundary state, reopen auctions

## Pending Verification Steps
1. Manual browser walkthrough with live auction session
2. Verify canUndo shows/disappears correctly on network state changes
3. Confirm draft restoration order matches prototype (drafts + confirmed transfers + balances)
4. Check persistence across browser tab reloads

## Compliance
- Strict reverse-order restoration flows from protocol spec section 8
- Draft restoration accepted per design choice (section 4)
- UI preserved from prototype (no visual/flex changes)
- End-to-end API contract via HTTP undo endpoint test