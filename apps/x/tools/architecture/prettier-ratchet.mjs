#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const baselinePath = path.resolve("config/baselines/prettier.json");
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "prettier",
    "--list-different",
    "**/*.{ts,tsx,mts,cts,js,mjs,cjs,json,jsonc,yml,yaml,md}",
  ],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

if (result.error || (result.status !== 0 && result.status !== 1)) {
  console.error(result.stderr || result.error);
  process.exit(result.status ?? 1);
}

const current = result.stdout.split(/\r?\n/u).filter(Boolean).sort();
if (process.argv.includes("--write")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${path.relative(process.cwd(), baselinePath)} (${current.length} files)`);
  process.exit(0);
}

const baseline = new Set(JSON.parse(fs.readFileSync(baselinePath, "utf8")));
const additions = current.filter((file) => !baseline.has(file));
if (additions.length > 0) {
  console.error("Prettier debt increased:\n" + additions.map((file) => `  - ${file}`).join("\n"));
  process.exit(1);
}
console.log(`Prettier: no new unformatted files (${current.length} baselined)`);
