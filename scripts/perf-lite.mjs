#!/usr/bin/env node
// perf-lite — the cheap, backend-less slice of the desktop perf gate.
//
// The full gate (tools/desktop-perf) packages the app and drives it against a
// local kind/API stack — too heavy for every PR. This checks the one budget we
// can validate with just a renderer build and no backend: the renderer asset
// size, read from the SAME source of truth (tools/desktop-perf/budget.json).
//
// Usage:
//   node scripts/perf-lite.mjs            # measure apps/x/apps/renderer/dist
//   (run the renderer build first; CI does `vite build` then this script)
import { readFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budgetPath = path.join(root, "tools/desktop-perf/budget.json");
const distDir = path.join(root, "apps/x/apps/renderer/dist");

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(p));
    else if (entry.isFile()) files.push({ path: p, size: statSync(p).size });
  }
  return files;
}

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
const limitMb = budget?.budgets?.rendererAssetSizeMb;
if (typeof limitMb !== "number" || !(limitMb > 0)) {
  console.error("perf-lite: rendererAssetSizeMb budget missing or invalid in budget.json");
  process.exit(2);
}

let files;
try {
  files = walk(distDir);
} catch {
  console.error(`perf-lite: renderer dist not found at ${distDir}. Build the renderer first.`);
  process.exit(2);
}

const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
const mb = totalBytes / (1024 * 1024);
const pct = (mb / limitMb) * 100;

console.log(`renderer bundle: ${mb.toFixed(2)} MB / ${limitMb} MB budget (${pct.toFixed(0)}%)`);
console.log("largest assets:");
for (const f of files.sort((a, b) => b.size - a.size).slice(0, 8)) {
  console.log(
    `  ${(f.size / (1024 * 1024)).toFixed(2).padStart(7)} MB  ${path.relative(distDir, f.path)}`,
  );
}

if (mb > limitMb) {
  console.error(
    `::error::renderer bundle ${mb.toFixed(2)} MB exceeds budget ${limitMb} MB ` +
      `(set in tools/desktop-perf/budget.json). Investigate new/large dependencies or missing code-splitting.`,
  );
  process.exit(1);
}
console.log("perf-lite: renderer bundle within budget ✓");
