# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The approved design deliverable is a browser-based, clickable, high-fidelity prototype. The production application's packaging remains undecided; this platform declaration describes the prototype, not a production deployment decision.

## Stack

Production framework and storage technology are undecided. The current task is a browser visual comparison, not production implementation.

## Users

One operator prepares and controls a two-team auction. The same screen is viewed close up on a computer and from a distance through a TV or projector during bidding and final presentation.

## Product Purpose

Help the operator collect individual member contributions into team bids, confirm candidate sales, track remaining gold, and present the resulting teams. Candidates and team members are distinct entities.

## Operating Context

Preparation prioritizes desktop data entry; live bidding and the final screen must also be readable by an audience. There is one shared control/presentation screen. Production use must work offline on one computer and retain local records and uploaded images.

## Capabilities and Constraints

- The approved product specification and domain glossary govern auction behavior.
- Turkish is the default interface language; English is also supported. User-authored content is not translated.
- Member and candidate lists have no upper count limit and use scrolling. The minimum four/even candidate count constraint remains.
- Team headers, remaining gold, and bid totals remain visible while long member and acquired-candidate lists scroll independently.
- Active candidate, latest confirmed bid, and action controls must remain accessible without scrolling those lists.
- Candidate images can be portrait, landscape, or square. Preserve the complete image without automatic cropping.
- A sale requires a dialog showing candidate image/name, latest confirmed bidding team's flag/name, and confirmed gold amount. Cancellation preserves the round.
- Auction preparation is permanently locked after starting. Auction actions can be undone in reverse order.
- Design ticket 0 covers all screens and important states, with an approved interactive prototype and English design documentation. All twelve implementation tickets are blocked by it.

## Brand Commitments

The user selected Tolkien's Middle-earth as the thematic reference, expressed as an atlas or chronicle. The shared interface uses light parchment, dark brown ink, dark green and brown tree details. Serious states may use Mordor-inspired ember red. This approved direction takes precedence over generic style recommendations.

## Evidence on Hand

The domain glossary, English product specification, historical identity ADR, and original Turkish brief are in the repository. No user-provided candidate images or team flags were supplied for the comparison; illustrative sample content must be identified as such.

## Product Principles

- Preserve the operator's awareness of the active candidate, confirmed bid, and next action.
- Keep atmosphere subordinate to legibility of balances, contributions, and controls.
- Preserve historical identities and confirmed auction information.
- Confirm consequential sales and make mistakes recoverable.

## Design Decisions

The user approved the complete ticket-0 prototype: light-parchment atlas world, A — Council triptych live layout, four-step preparation, catalog-left/list-right editing, inline team preparation, home/catalog/list/battlefield management, live bidding with sale confirmation and undo, and final team presentation. See [Design Record](./docs/odi-bid-battle-design.md).

Remaining open decisions are final production typography, motion, artwork, physical projector readability, and production implementation architecture. Those belong to implementation tickets, not this product record.
