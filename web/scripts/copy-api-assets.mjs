// Copies backend-owned runtime assets into the web project before the Vercel
// build so file tracing can package them with the API function.
// Single source of truth stays api/src/assets; web/api/assets is generated.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "api", "src", "assets");
const dest = join(here, "..", "api", "assets");

mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  cpSync(join(src, file), join(dest, file));
}
console.log(`api assets copied: ${src} -> ${dest}`);
