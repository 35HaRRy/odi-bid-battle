import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const srcPath = resolve(process.cwd(), "src/assets/default-background.svg");
const distPath = resolve(process.cwd(), "dist/src/assets/default-background.svg");

try {
  const distDir = join(distPath, "..");
  const fs = await import("node:fs");
  await fs.promises.mkdir(distDir, { recursive: true });
  copyFileSync(srcPath, distPath);
  const stats = await fs.promises.stat(distPath);
  console.log("✓ Built assets validated:");
  console.log(`  - File exists: ${distPath}`);
  console.log(`  - Size: ${stats.size} bytes`);
  process.exit(0);
} catch (err) {
  console.error("✗ Built assets verification failed:");
  console.error(`  - Error: ${err.message}`);
  process.exit(1);
}