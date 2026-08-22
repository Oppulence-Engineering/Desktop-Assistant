import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(
  appRoot,
  ".next/server/app/(product)/app/page_client-reference-manifest.js",
);

// Baseline captured from the first guarded App Router build with 7.5–9% headroom.
// These are intentionally repo-specific until feature routes split the legacy island.
const budgets = {
  productJavaScriptBytes: 3_400 * 1024,
  productCssBytes: 350 * 1024,
  largestProductChunkBytes: 2_350 * 1024,
};

const source = fs.readFileSync(manifestPath, "utf8").trim();
const manifest = JSON.parse(source.slice(source.lastIndexOf(" = ") + 3, source.lastIndexOf(";")));
const routeSuffix = "/app/(product)/app/page";
const jsEntry = Object.keys(manifest.entryJSFiles).find((key) => key.endsWith(routeSuffix));
const cssEntry = Object.keys(manifest.entryCSSFiles).find((key) => key.endsWith(routeSuffix));
if (!jsEntry || !cssEntry) throw new Error("Could not find the /app client bundle manifest");

const jsSizes = manifest.entryJSFiles[jsEntry].map((file) => ({
  file,
  bytes: fs.statSync(path.join(appRoot, ".next", file)).size,
}));
const cssSizes = manifest.entryCSSFiles[cssEntry].map(({ path: file }) => ({
  file,
  bytes: fs.statSync(path.join(appRoot, ".next", file)).size,
}));
const jsTotal = jsSizes.reduce((sum, item) => sum + item.bytes, 0);
const cssTotal = cssSizes.reduce((sum, item) => sum + item.bytes, 0);
const largest = jsSizes.sort((left, right) => right.bytes - left.bytes)[0];

console.log(`/app JavaScript: ${(jsTotal / 1024).toFixed(1)} KiB`);
console.log(`/app CSS: ${(cssTotal / 1024).toFixed(1)} KiB`);
console.log(`Largest /app chunk: ${largest.file} (${(largest.bytes / 1024).toFixed(1)} KiB)`);

if (
  jsTotal > budgets.productJavaScriptBytes ||
  cssTotal > budgets.productCssBytes ||
  largest.bytes > budgets.largestProductChunkBytes
) {
  console.error("Bundle budget exceeded. Run `npm run analyze` to inspect the route graph.");
  process.exit(1);
}
