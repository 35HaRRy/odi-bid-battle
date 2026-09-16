import { buildApp } from "./app.js";
import { PgStore } from "./store.js";

// Standalone entry point for local development (`npm run dev -w api`) and
// `npm start -w api`. Vercel uses web/api/index.ts instead and never runs
// this file.
const PORT = Number(process.env.PORT ?? 3001);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://bidbattle:bidbattle@localhost:5433/bidbattle";

if (process.env.VITEST !== "true") {
  const store = await PgStore.connect(DATABASE_URL);
  const app = buildApp(store);
  app.listen(PORT, () => console.log(`api on :${PORT}`));
}
