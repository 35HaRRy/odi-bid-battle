# UI asset sources

- `web/public/logo.jpg`: application logo supplied by the project owner.
- `web/public/google-g.png`: unmodified standard-color Google G, downloaded from https://developers.google.com/static/identity/images/g-logo.png on 2026-11-05. Used only with the localized “Continue with Google” button, following https://developers.google.com/identity/branding-guidelines (white surface, 1px #747775 border, #1f1f1f Google Sans Medium 14/20 text, 12px horizontal padding and 10px icon gap).
- `web/public/google-sans-medium.woff2`: Google Sans Medium, self-hosted from Google Fonts to avoid third-party font requests. Subset to the characters in `Continue with Google` and `Google ile devam et`; regenerate if these translations change. SIL Open Font License included in `web/public/google-sans-OFL.txt`; source https://github.com/google/fonts/tree/main/ofl/googlesans.
- UI line icons and social brand silhouettes are inline SVG; decorative icons are hidden from assistive technology and their controls have text or accessible labels.
