---
status: accepted
---

# Preserve referenced candidates and started auction history

Candidates are reusable across lists, but changing an already-used candidate in place would rewrite the identity and appearance expected by those lists. Catalog edits to a candidate used in any list therefore create a new candidate containing the copied information and requested changes, archive the original without replacing existing references, and leave started auctions' preparation information fixed so later catalog and list changes cannot rewrite their history.

## Considered options

- **Update referenced candidates in place:** Simple editing and fewer records, but existing lists silently change and historical meaning becomes unstable.
- **Retain immutable candidate information only after auction start:** Protects running and completed auctions, but does not preserve the referenced candidate in reusable lists and drafts before starting.
- **Copy on edit for referenced candidates, plus fixed information at auction start (chosen):** Preserves existing list references and auction history while allowing a revised candidate to be reused explicitly.

## Consequences

- Existing lists continue displaying the original candidate; they do not automatically adopt its replacement.
- Archived candidates are hidden from new catalog selection but remain available to their existing references.
- Additional records and explicit replacement choices are accepted in exchange for stable historical meaning.
- Drafts can follow saved-list changes until their first local edit or auction start. A local list edit creates an independent list; starting fixes the auction's preparation information.
- Undo reverses auction actions, not the preparation lock. A new draft is required to change a started auction's preparation.

See the [product specification](../odi-bid-battle-spec.md) for the complete editing, copying, and auction rules, and the [domain glossary](../../CONTEXT.md) for terminology.
