import { copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const srcDir = join(process.cwd(), "src/assets");
const distDir = join(process.cwd(), "dist/src/assets");

try {
  await mkdirSync(distDir, { recursive: true });
  const files = await import("node:fs").then(fs => fs.promises.readdir(srcDir));
  for (const file of files) {
    const srcPath = join(srcDir, file);
    const distPath = join(distDir, file);
    copyFileSync(srcPath, distPath);
  }
  console.log("Assets copied from src/assets to dist/src/assets");
  console.log(`Copied ${files.length} file(s)`);
} catch (err) {
  console.error("Failed to copy assets:", err);
  process.exit(1);
}