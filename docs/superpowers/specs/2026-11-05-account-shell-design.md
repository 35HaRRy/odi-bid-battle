# Account services and shared page chrome

## Approved direction
Repair local authentication prerequisites without deleting data. Use one shared header/footer on landing, account, loading/error, and workspace pages, preserving the existing visual identity and content width.

## Requirements
- Full-width header/footer bands with content aligned to the existing workspace width.
- Logo (`/logo.jpg`) and `2 Ordular savaşı` wordmark at left; language control at right, avatar icon for signed-in users. Preserve linking/logout actions.
- Keep the existing workspace menu and functionality; remove duplicated page branding/language controls.
- Footer links, in order: website, GitHub repository, LinkedIn, X, Instagram, exactly as supplied by the user.
- Account branding uses the supplied logo; Google button follows Google's icon, spacing, and color guidance. Account navigation uses compact icon buttons with unbroken labels and responsive wrapping between buttons.
- Apply the existing schema to the approved local development database, retaining legacy records. SMTP authentication failure must remain explicit; never bypass email verification or invent working credentials.

## Approaches
Selected: shared chrome around SessionBoundary's route content. Avoids duplicate UI on every route and naturally covers loading/error states.
Rejected: editing each page independently; duplicates branding, session controls, and footer maintenance.

## Constraints and verification
No new dependencies, no secret disclosure, no production changes, no automatic claiming of legacy content, no commits unless requested. Keep existing user modifications. Test static rendering and auth error behavior, run both suites/typechecks, and inspect desktop/mobile browser layouts.
