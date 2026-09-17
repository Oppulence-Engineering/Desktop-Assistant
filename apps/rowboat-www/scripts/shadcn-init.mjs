#!/usr/bin/env node
/**
 * Validates the rowboat-www shadcn monorepo wiring without overwriting config.
 * Shared primitives install into `packages/ui` via `npm run ui:add`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const uiRoot = path.resolve(appRoot, "../../packages/ui");
const executable = path.join(
  appRoot,
  "node_modules/.bin",
  process.platform === "win32" ? "shadcn.cmd" : "shadcn",
);

function run(args, cwd) {
  const result = spawnSync(executable, args, { cwd, stdio: "inherit" });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!fs.existsSync(executable)) {
  console.error("shadcn CLI is not installed. Run `npm install` in apps/rowboat-www.");
  process.exit(2);
}

for (const [label, cwd] of [
  ["rowboat-www", appRoot],
  ["@oppulence/ui", uiRoot],
]) {
  console.log(`\n=== shadcn info (${label}) ===`);
  run(["info"], cwd);
}

console.log(`
shadcn is configured for this monorepo.

Add shared primitives to packages/ui:
  npm run ui:add -- <component>
  npm run ui:add -- button --diff

Inspect upstream changes before overwriting existing primitives.
`);
