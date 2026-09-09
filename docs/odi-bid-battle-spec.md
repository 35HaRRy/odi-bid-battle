# ODI Bid Battle — Product Specification

Status: Approved requirements, consolidated from the design interview.

## 1. Sources and scope

- Original brief: [ODİ Bid Battle](./ODİ%20Bid%20Battle.md).
- Canonical vocabulary: [Domain glossary](../CONTEXT.md).
- Historical identity decision: [ADR 0001](./adr/0001-preserve-referenced-candidates-and-auction-history.md).

This specification incorporates the approved interview decisions. Where the original brief differs, the rules below take precedence.

The application lets one operator prepare and run a two-team auction, then present the acquired candidates on opposing teams. The first release operates offline on one computer, with local persistence and a shared control/presentation screen. The final presentation does not simulate a battle or calculate a winner.

## 2. Language and persistence

- Support Turkish and English interfaces; Turkish is the default.
- Remember the selected language. Changing it during an auction must not change auction state.
- Translate application labels, controls, validation messages, and confirmation content. Do not translate user-entered names, slogans, or descriptions.
- Use Turkish terminology in the Turkish interface and English terminology in the English interface. Technical documentation is English.
- Save drafts, preparation edits, and confirmed auction actions automatically. Reopening the application must allow an auction to resume from its saved state.
- Keep multiple draft, ongoing, and completed auctions. The operator chooses which one to open and manages one auction on screen at a time.
- Each auction has a name, editable in preparation and locked after starting.
- Images are uploaded from local files and stored as application-owned copies; subsequent use must not depend on the original file location.

## 3. Preparation and reusable records

### 3.1 Candidates and candidate lists

- A candidate has a name and image.
- A candidate list is named, ordered, and reusable. It supports adding existing candidates, creating new candidates, editing candidates, removing entries, and reordering entries.
- A particular candidate record may occur only once in a list.
- Incomplete lists and temporarily invalid drafts may be saved. At auction start, the selected list must contain an even number of candidates, at least four.
- Editing a candidate from auction preparation creates a new, reusable candidate record and uses that record in the edited list; it does not modify the original candidate.
- When editing a candidate directly in the catalog, if candidate A has been used in any candidate list, copy all of A's information into a new candidate B and apply the edits to B. Archive A so that it disappears from the catalog but remains visible in lists and auctions that use it. Do not replace A with B in those lists automatically.
- A catalog candidate that has never been used in a candidate list can be edited in place.
- Removing a referenced candidate or battlefield archives it rather than breaking existing references. Archived records are unavailable for new selection but remain visible in existing uses.
- Removing a candidate list must not affect auctions already created from it.

### 3.2 Selecting and copying a list

1. Select a battlefield and an existing candidate list for the auction draft.
2. Until the first local list edit or auction start, the draft follows the selected saved list. Edits to that saved list, including its order, are reflected in drafts still following it.
3. The first local list edit creates an independent named copy with all list information and entries. Apply that first edit and subsequent edits to the copy.
4. Renaming alone counts as an edit and creates the copy.
5. Candidate removal, addition, editing, and reordering also count as list edits. Candidate editing creates a new candidate record as described above; copying a list does not by itself duplicate every candidate identity.
6. The copy may remain even if its edits are subsequently undone; do not require automatic reconnection to the original list.
7. Once the auction starts, its candidate information and order are fixed independently of later catalog or saved-list changes.

### 3.3 Battlefield and images

- A battlefield has a name, image, geographical description, and historical background.
- Supply a default initial auction background, replaceable during preparation.
- Candidate images, the battlefield image, and team flags are required before starting. The initial background must be available, either supplied or replaced.
- Team member avatars are optional.

### 3.4 Teams and members

- Prepare exactly two teams in panels 1 and 2.
- Each team has a name, flag, and slogan.
- Add and edit members in either panel and move members between panels during preparation.
- Each member has a name, optional avatar, and positive integer initial gold, defaulting to 10.
- A team must have at least one member at start.
- Team initial gold is calculated from member initial gold, not entered separately.
- Both teams must have equal total initial gold at start. Temporary inequality is permitted while editing a draft.
- Teams and members belong to their auction rather than a separate reusable team/member catalog.
- Creating a new draft from a previous auction reuses its preparation information and member initial gold. It does not carry over bids, sales, acquired candidates, or remaining balances.

### 3.5 Start validation and lock

Before starting, validate the selected battlefield, required preparation fields and images, the candidate-list constraints, two nonempty teams, positive integer member initial gold, and equal team initial budgets. Display validation errors at the relevant fields and prevent starting until resolved.

Starting fixes the auction name, list and candidate information, battlefield and background selection, teams, and members. No preparation changes are allowed afterward, even if every bidding action is undone. To change preparation, create a new draft from the auction.

## 4. Gold, capacity, and ordering

Let N be the candidate count fixed when the auction starts.

- Each team's capacity is N / 2. Skips and early termination do not reduce this capacity.
- A team cannot bid after reaching capacity.
- Initial member gold and confirmed team bids are positive integers.
- Remaining member balances and member contributions are nonnegative integers. A member can contribute zero and can spend their entire balance.
- Each contribution must not exceed that member's remaining gold.
- Team remaining gold is the sum of its members' remaining balances.
- Confirming a bid does not deduct gold. Only a confirmed sale deducts the winning members' confirmed contributions.
- A team is eligible to open bidding when it has at least one gold and has not reached capacity.
- Candidate positions 1, 3, 5, and so on schedule panel 1's team to start; positions 2, 4, 6, and so on schedule panel 2's team.
- The scheduled starting team is independent of which team actually opened or won the previous round, and of whether that round was skipped.

## 5. Auction screen

Show during the auction:

- Both teams' names, flags, slogans, remaining total gold, and current round contribution totals.
- Members' names, optional avatars, remaining gold, and current round contributions.
- Each team's acquired candidates with their names and purchase prices.
- The active candidate's name and image when a round is active.
- The last confirmed bidding team and bid amount, only after a bid exists.
- The team whose turn it is to bid when a round is active.

On initial entry there is no active candidate or bidding round. Show the teams and let the operator send the first candidate. Do not automatically present a candidate after a sale or skip.

## 6. Round workflow

### 6.1 Send the next candidate

- Permit this only between rounds, when another candidate remains and the auction is not awaiting termination for lack of eligible teams.
- Present the next unprocessed candidate in the fixed list order.
- Initialize member contributions to zero and hide the last-bid display.
- Identify the scheduled starting team and apply the eligibility/pass rules below.
- Do not permit another candidate to be sent while the active round is unresolved.

### 6.2 Opening eligibility and the special pass

| Condition | Opening behavior |
| --- | --- |
| Scheduled starting team is eligible | It must submit a positive opening bid; it cannot pass. |
| Scheduled starting team is ineligible, other team is eligible | Transfer the opening turn to the other team. It may submit a positive bid or pass. |
| Neither team is eligible | Do not open another round; enable auction termination. |

Ineligibility means zero remaining team gold or full capacity. The special pass exists only when the opening turn is transferred because the scheduled team is ineligible. It is not a general pass control for responding to bids.

For example, if A has no gold and B is eligible, B may pass when A was scheduled to start. If B was already scheduled to start, B must bid even though A has no gold.

An allowed pass marks the active candidate as skipped, awards it to neither team, changes no balances, and closes the round. Never offer that candidate again in this auction. Return to the between-round state and evaluate termination conditions.

### 6.3 Enter and confirm bids

1. Only the team whose turn it is can edit member contribution fields. Other members' contributions are read-only.
2. Calculate the team's displayed contribution total from its member fields. Unconfirmed entries are draft values, not a bid.
3. On bid confirmation, validate integer contributions, member balances, team capacity, and a positive total strictly greater than the latest confirmed bid, if any.
4. For an invalid bid, show an error and leave the confirmed bid and turn unchanged.
5. For a valid bid, preserve the confirmed per-member contributions and total, update the last-bid display, and move the turn to the other team.
6. Preserve each team's contribution values when its turn returns; make them editable again. A larger bid is a replacement total for this candidate, not an additional charge on top of its prior bid.
7. An ineligible team cannot submit a bid. When the other team cannot respond, the operator can still complete the sale to the latest confirmed bidder; no response or pass is required.

### 6.4 Confirm and complete a sale

The operator can request completion as soon as at least one confirmed bid exists, including before the other team responds. No confirmed bid means no sale can be completed.

Before completing a sale, show a confirmation dialog containing:

- Candidate image and name.
- The latest confirmed bidding team's flag and name.
- The latest confirmed bid amount in gold.

Use the confirmed bid, never another team's unconfirmed fields. Canceling returns to the auction screen without changing the candidate, contributions, confirmed bids, balances, or turn.

On confirmation:

1. Award the candidate to the latest confirmed bidding team at its confirmed bid price.
2. Deduct that team's confirmed member contributions from the corresponding member balances.
3. Leave the losing team's balances unchanged.
4. Recalculate team remaining gold and acquired candidate counts.
5. Clear both teams' round contributions and bid displays, including unconfirmed entries.
6. Remove the active candidate and hide the last-bid and next-turn indicators.
7. Return to the between-round state without automatically presenting another candidate.
8. Update the background and evaluate termination conditions.

## 7. Progression, termination, and presentation

### 7.1 Background transition

Use the selected initial background until the first N / 2 candidates have been processed. A sale or allowed skip both count as processing a candidate. Immediately after that boundary, switch to the selected battlefield image.

After the transition, show the battlefield name and a control to open or close a panel containing its geography and history. Provide the same information panel on the final presentation screen. Do not imply the halfway boundary was reached if the auction ends before it.

### 7.2 Termination

Evaluate termination only after the active round has been resolved. An existing confirmed bid must be settled through the sale workflow before ending the auction.

Termination is available when either:

- No unprocessed candidates remain; or
- Neither team is eligible: each lacks gold, free capacity, or both.

This includes both teams having zero gold, and a full-capacity team retaining gold while the other team has none.

When a termination condition holds, disable bid/next-candidate progression and show an explicit end-auction control. The operator confirms termination; it is not automatic. Then show the localized "Let the battle begin" control (Turkish: "Savaş başlasın"). Candidates not yet presented remain unassigned; they are not classified as skipped.

Equal positive starting budgets and the capacity rules do not require equal acquired candidate counts. They also do not create a normal valid completion in which one team has acquired no candidates: a team that has bought nothing still has its positive budget and free capacity.

### 7.3 Final presentation

- Open the final presentation only after the auction has been ended.
- Arrange the teams opposite one another, showing their names, flags, and slogans, with acquired candidates displayed using their images.
- There is no additional candidate-image secrecy rule: active candidates are visible during bidding, acquired candidates appear by name and price on the auction screen, and by image on this screen.
- Do not simulate combat or determine a winner.
- Allow return to the auction screen without changing the auction's data or automatically reversing termination.

## 8. Undo and state restoration

- Support repeated undo in reverse action order for sending a candidate, confirming a bid, skipping a candidate, completing a sale, and ending the auction.
- Undo cannot directly edit an arbitrary earlier action; later actions must be reversed first.
- Restore the affected candidate, confirmed bids, member contributions, balances, team capacity usage, scheduled/actual turn, progress, and background together.
- Undoing a sale returns to its preceding active round and refunds exactly the deducted contributions.
- Undoing a skip restores that candidate's active round and its permitted opening choice.
- Undoing a later candidate's presentation is required before undoing the previous round's sale or skip.
- Undoing termination restores the preceding state. It does not unlock preparation.
- Opening or canceling the sale confirmation dialog does not itself create a sale or charge gold.

## 9. State transition summary

These are behavioral states, not a prescribed implementation architecture.

| State | Action or condition | Result |
| --- | --- | --- |
| Draft | Start with valid preparation | Between rounds; preparation permanently locked |
| Between rounds | Send next candidate while progression is allowed | Active round, no confirmed bid |
| Active round | Confirm valid bid | Active round with updated confirmed bid and turn |
| Active round, no bid | Permitted opening pass | Candidate skipped; between rounds or ready to end |
| Active round, confirmed bid | Request sale | Sale confirmation dialog |
| Sale confirmation | Cancel | Same active round and data |
| Sale confirmation | Confirm | Candidate sold; between rounds or ready to end |
| Between rounds | Termination condition holds | Ready to end; no further progression |
| Ready to end | End auction | Ended; battle-presentation control visible |
| Ended | Open presentation | Final team presentation |
| Final presentation | Return | Ended auction screen |
| Applicable auction state | Undo latest confirmed action | Its preceding state; preparation remains locked |

## 10. Acceptance scenarios

1. **Start validation:** A three-candidate list or unequal team initial budgets can be saved as a draft but cannot start. Four candidates and two nonempty teams with equal positive budgets satisfy those numerical constraints.
2. **Zero values:** A member cannot start with zero gold. A member may contribute zero, and a member who spends their entire balance has a valid zero remaining balance.
3. **Strictly increasing totals:** After A confirms 5, B's 5 is rejected without changing the turn; B's affordable 6 is accepted. No balance is deducted yet.
4. **Retained contributions:** A confirms member contributions of 2 and 3. After B confirms 6, A's fields still show 2 and 3; changing them to 4 and 3 produces a replacement bid of 7, not 12.
5. **Unconfirmed response and sale dialog:** A has confirmed 5; B has entered but not confirmed 7. The sale dialog shows the candidate and A's flag, name, and 5 gold. Cancel preserves the round; confirm awards the candidate to A for 5 and clears B's draft entries without charging B.
6. **Transferred opening pass:** A is scheduled but has zero gold. Eligible B may pass; the candidate stays unassigned and is never repeated. The next list position schedules B, regardless of who acted in this round.
7. **No normal opening pass:** B is scheduled, has gold and capacity, while A has zero gold. B must submit a positive opening bid.
8. **Capacity:** With eight initial candidates, A cannot bid after acquiring four. If A is scheduled, eligible B receives the opening turn and may pass. The capacity stays four even if candidates are skipped.
9. **Mixed inability to buy:** A has four of eight candidates and gold remaining; B has zero gold. Between rounds, the end-auction control becomes available even though not all gold is exhausted.
10. **Both budgets exhausted:** A and B each start with one gold in a four-candidate auction. After each has bought one candidate for one gold, the remaining candidates cannot be presented; the operator can end the auction with them unassigned.
11. **Resolve before termination:** A's confirmed bid will fill its last free capacity slot and B cannot bid. Complete the active sale first, then evaluate whether another round can open or termination is available.
12. **Halfway skip:** In an eight-candidate auction, resolving candidate four by an allowed skip still switches the background. Undoing that skip restores its active round and the initial background.
13. **Undo across rounds:** After selling candidate one and presenting candidate two, undo presentation before undoing the sale. Candidate one becomes active again and exactly its winning contributions are refunded.
14. **List rename:** Renaming a selected list in preparation creates an independent saved copy without changing the original list. Reverting the name does not require deleting the copy.
15. **Catalog identity:** Candidate A is referenced by a list. Editing A in the catalog produces B with the edited information and archives A. The list still displays A, while new catalog selection offers B instead of A.
16. **Shared draft reference:** Two untouched drafts select the same saved list. A saved-list reorder affects both. After one draft makes its first local list edit, later edits to the original list affect only the still-linked draft.
17. **Permanent preparation lock:** Undo every bid, sale, skip, and candidate presentation in a started auction. Its preparation remains uneditable; creating a new draft is the route to changes.
18. **Explicit ending:** Processing the last candidate enables ending but does not open the final screen automatically. After ending, the battle-presentation control appears. Returning from that screen leaves the auction ended; undoing termination restores its prior state.
19. **Offline recovery and language:** Reopen an auction after a saved sale without internet access. Acquisitions, member balances, fixed candidate information, and stored images remain available. Switching Turkish to English changes interface text, not user content or auction state.

## 11. Implementation boundary

These requirements do not select a framework, storage engine, packaging method, or undo implementation. Those technical choices must preserve the offline behavior, fixed historical information, and reversible action semantics defined here.
