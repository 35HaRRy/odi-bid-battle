# Battlefield Presentation Assets — Issue #5

Date: 2026-09-10. Approach A approved; written specification awaiting review.

## Scope and decisions

Implement reusable battlefield management and draft preparation step 1. The operator approved deferring live halfway transitions and final-screen information panels to issue #12. Those acceptance criteria remain deferred, not satisfied by this slice.

Use the approved parchment atlas visual design: battlefield library cards, selection list, full-image map preview, geography/history fields, and background replacement controls. Turkish is the default interface language; English labels and validation are also supported. Names, geography, and history are single user-authored strings and are never translated.

## Record identity

A battlefield requires a nonblank name (maximum 200 characters), nonempty image, nonblank geography, and nonblank history. Creation and editing validate all four fields. Editing without uploading a replacement image retains the existing application-owned image bytes.

Approach A extends copy-on-edit to battlefields explicitly: editing a battlefield referenced by an auction creates a new battlefield containing the copied information plus edits, archives the original, and preserves every existing auction reference. Editing an unreferenced battlefield updates it in place. The copy and archive occur atomically.

Archiving hides a battlefield from the library and new selections. Existing drafts retain their selected archived battlefield, including its name, image, geography, and history. Replacing or clearing that selection is allowed; selecting an archived record anew is rejected. Archiving is used for removal regardless of reference count.

## Persistence and API

Store battlefields in a dedicated relational table with identity, name, image bytes, image MIME type, original image filename, geography, history, archive timestamp, and creation timestamp. Images are local application-owned copies, independent of the uploaded file's original location.

Connect the existing auction battlefield identifier to battlefield records through a foreign key. Existing nullable values remain valid; migration must detect any pre-existing dangling identifiers and report them rather than silently discard selections. Normal removal uses archive, preserving references.

Store an optional initial-background upload in dedicated nullable auction image-byte, MIME-type, and filename columns. Keep binary data out of preparation JSON. A bundled local parchment image supplies the default for every draft without an override. Each draft can replace its background or reset to the bundled default independently.

Provide battlefield create, list-active, get-by-ID, image, edit, and archive endpoints. Extend the existing draft battlefield-selection endpoint with validation. Provide draft background upload, retrieval, and reset endpoints. Background retrieval resolves the default when no override exists. Metadata responses omit image bytes.

Battlefield selection and background changes save immediately and do not fork the candidate list. Incomplete drafts can retain no battlefield. Reject presentation-asset changes for non-draft auctions. Uploads follow the existing 5 MB limit; invalid or unsupported images produce actionable validation errors. Missing records return not-found errors; persistence failures never report successful saving.

## Web behavior

Enable the Battlefields navigation item. Use library cards with full uncropped images, names, geography summaries, and edit/archive actions. The editor contains labelled name, upload, geography, and history fields, an image preview, inline errors, and save/cancel actions. Archive requires confirmation explaining preserved references.

Draft preparation supports navigation between battlefield step 1 and the existing candidate-list step 2. Step 1 shows active selection options and the selected battlefield's full image, name, geography, and history. An archived current selection remains visible and is clearly marked. The background section previews the resolved initial image and offers replacement and reset controls. Empty-library and unselected states explain the next action.

Use focused battlefield components rather than embedding the entire feature in the existing application component. Reuse atlas CSS classes and tokens; add only the layout and responsive rules needed by these components. Keyboard operation, labelled controls, visible focus, narrow-screen stacking, and image containment are required. Failed saves keep editor input available for retry, and pending saves prevent duplicate submissions.

## Agreed testing seams

Use TDD for battlefield validation and PostgreSQL persistence behavior. Cover required fields, image retention/replacement, unreferenced edits, referenced copy-on-edit, atomic failure, archive reference preservation, rejected archived selections, clearing selections, and independent background replacement/reset. Verify draft asset changes preserve candidate-list follow state and reject non-draft changes.

Add meaningful endpoint/client and rendered UI checks for creation, editing, selection, background upload/reset, error recovery, and Turkish/English labels. Verify persistence by reopening records and compare stored image bytes with uploaded bytes. Check atlas library and preparation layouts in a browser at desktop and narrow widths.

Run typechecking and relevant single test files during implementation. Run the full test suite once after implementation, then use the requested code-review workflow. Fix findings and rerun affected checks when necessary. Commit intended work to the current branch.

## Deferred integration

Issue #12 will consume the saved battlefield and background to switch the scene after N / 2 sold-or-skipped candidates and show geography/history during live and final presentation. Start-time snapshotting and permanently locked preparation belong to the start-auction slice; this work supplies preserved asset records and rejects non-draft asset edits.

## Self-review

Scope is limited to battlefield data, library, and draft assets. Copy-on-edit is an explicitly approved battlefield rule. Binary storage is separate from JSON. Archived selection retention differs from new selection. Default background is a bundled local image. Live/final acceptance criteria remain explicitly deferred.
