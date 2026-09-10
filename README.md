# ODI Bid Battle — issue #2 slice

Reusable candidate lists with local images (spec §2 + §3.1).

## Run

```sh
docker compose up -d db
npm install
npm run test
npm run typecheck
# api :3001 (DATABASE_URL default postgres://bidbattle:bidbattle@localhost:5433/bidbattle)
npm run build -w api && node api/dist/src/server.js
# web :5173 (VITE_API_URL default http://localhost:3001)
npm run dev -w web
```

Images stored as app-owned `bytea` copies in Local Postgres. Same candidate
record rejected twice in one list (409). Drafts may be incomplete.
Persistence failure returns 500 + UI banner, never fake-saved.
TR default, EN supported; user names untranslated; pref in localStorage.
