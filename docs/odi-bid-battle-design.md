# ODI Bid Battle — Design Record

Status: Approved interactive prototype. English design source for ticket 0.

## 1. Sources

- Product behavior: [Product Specification](./odi-bid-battle-spec.md).
- Vocabulary: [Domain glossary](../CONTEXT.md).
- Prior layout decision: [Live Auction Layout Comparison](./auction-layout-comparison.md).
- Product context: [PRODUCT](../PRODUCT.md).
- Interactive prototype: [.superpowers/brainstorm/49-1789040875/content/preparation-divan.html](../.superpowers/brainstorm/49-1789040875/content/preparation-divan.html) with `full-prototype.css` and `full-prototype.js` in the same directory.
- Verification scripts: [.superpowers/brainstorm/49-1789040875/verify-full-prototype.js](../.superpowers/brainstorm/49-1789040875/verify-full-prototype.js) and [verify-finish.js](../.superpowers/brainstorm/49-1789040875/verify-finish.js).

The prototype uses session-only sample data. It is a design artifact, not production implementation.

## 2. Approved visual world

- Light parchment atlas/chronicle.
- Dark brown ink for text, frames, and map lines.
- Dark green and brown tree/branch motifs for identity and section markers.
- Ember red reserved for consequential states: validation failures, exhausted gold or capacity, destructive confirmation.
- Serif display headings; plain readable controls for names, contributions, balances, and validation text.
- Full candidate, battlefield, flag, and avatar images are preserved without automatic cropping.
- Sample emblems and maps are explicitly illustrative. Final artwork and final typography remain open.

## 3. Approved application structure

Top-level navigation:

- Auctions.
- Candidate Catalog.
- Candidate Lists.
- Battlefields.
- Current Draft or live Auction Council.

Turkish is default; English is fully supported. User-authored names, slogans, geography, and history are not translated. Language preference persists in the same browser tab in the prototype.

## 4. Approved screens

### Auctions home

- Named auction records with draft, in-progress, and completed states.
- Search, open/resume, create new auction, and create new draft from an existing record.
- Help text explains preparation before live bidding and reuse without rewriting started-auction history.

### Candidate catalog

- Named illustrated candidates.
- Search, create, edit, and archive.
- Editing a candidate referenced by any list creates a new record and archives the original.
- Existing lists retain the original candidate.

### Candidate lists

- Saved ordered lists with candidate thumbnails.
- Create draft from list.
- Archive without breaking auctions already created from the list.

### Battlefields

- Name, image, geography, and history.
- Create, edit, and archive.
- Validation requires all four fields.

### Guided preparation

Four steps:

1. Battlefield.
2. Candidate List.
3. Teams.
4. Final Review.

Behavior:

- Step indicator and back/next navigation.
- Incomplete preparation can be saved as draft.
- Candidate editor uses catalog on the left and ordered selected list on the right.
- Both panes scroll independently.
- Reorder with drag-and-drop plus move-up/move-down buttons.
- First local list edit, including rename alone, creates an independent copy and preserves the source.
- Team preparation uses two side-by-side panels.
- Inline member name, optional avatar, and positive integer initial gold.
- Add members inline and transfer them with a directional button.
- Calculated team totals and difference remain visible.
- Final review shows linked error summary with keyboard focus, inline field errors, and preparation lock notice.
- Starting transitions to the live council with no active candidate.

### Live auction council

Approved A — Council triptych:

- Active candidate centered between two team panels.
- Team headers, remaining gold, bid totals, active candidate, latest confirmed bid, and action controls remain visible.
- Member and acquired-candidate lists scroll independently.
- Contribution fields are editable only for the team whose turn it is.
- Sale dialog shows candidate image/name, latest confirmed bidding team's flag/name, and confirmed gold amount.
- Cancel preserves unconfirmed entries.
- Confirm deducts only the winner's confirmed contributions.
- Special pass appears only when the scheduled starting team is ineligible and the turn transfers.
- Skipped candidates are never repeated.
- Explicit end-auction confirmation.
- Undo restores the preceding live state without unlocking preparation.
- After half the candidates are processed, the battlefield background and information control become available.
- No horizontal document overflow at tested 390, 1280, 1440, and 1920 widths.

### Final presentation

- Opposing teams with names, flags, slogans, and acquired candidates by image and price.
- Battlefield information control.
- Skipped, unpresented, and acquired counts are distinguished.
- No battle simulation or winner calculation.
- Return to the ended council without changing data.

## 5. Verification

Full prototype flow passed 30 checks:

- Home, catalog, lists, battlefields, preparation, validation, language switching, sale dialog, cancellation behavior, deduction behavior, normal versus transferred opening pass, skip, undo, early termination, final presentation, reload persistence, cloned draft behavior, mobile and laptop overflow, and zero JavaScript page errors.

Finish verification passed:

- Both team tables use `Avatar` header aligned to member rows with 0 px name and gold offset.
- Language selector width is 90 px at 390 px viewport.
- No document overflow at 390 px preparation, 1280 px team preparation, 1280 px live council, and 1920 px live council.
- English preparation labels render; user content remains untranslated.
- Catalog, battlefield editor, live undo restoration, and final screenshots recaptured.

Captured evidence:

- `review-home.png`
- `review-battlefield.png`
- `review-candidates.png`
- `review-teams.png`
- `review-final-check.png`
- `review-sale-dialog.png`
- `review-divan.png`
- `review-result.png`
- `review-english.png`
- `review-catalog.png`
- `review-battle-editor.png`
- `review-live-laptop.png`
- `review-live-large.png`
- `review-mobile.png`
- `review-laptop.png`

## 6. Explicitly open

- Readability on the user's physical TV or projector and minimum live/result viewport.
- Final production typography, motion, and artwork.
- Production framework, storage, packaging, and implementation architecture.
- All implementation tickets remain separate work blocked by ticket 0.
