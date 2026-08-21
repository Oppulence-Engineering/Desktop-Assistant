#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const baselinePath = path.resolve("config/baselines/knip.json");
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "knip",
    "--config",
    "config/knip.json",
    "--no-progress",
    "--no-exit-code",
    "--reporter",
    "json",
  ],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

if (result.error || result.status !== 0) {
  console.error(result.stderr || result.error);
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout);
const ignoredKinds = new Set(["catalog", "catalogReferences", "enumMembers", "namespaceMembers"]);
const fingerprints = [];
for (const issue of report.issues ?? []) {
  for (const [kind, entries] of Object.entries(issue)) {
    if (kind === "file" || ignoredKinds.has(kind) || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : entry.name;
      if (name) fingerprints.push(`${issue.file}|${kind}|${entry.namespace ?? ""}|${name}`);
    }
  }
}
fingerprints.sort();

if (process.argv.includes("--write")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(fingerprints, null, 2)}\n`);
  console.log(
    `Updated ${path.relative(process.cwd(), baselinePath)} (${fingerprints.length} issues)`,
  );
  process.exit(0);
}

const baseline = new Set(JSON.parse(fs.readFileSync(baselinePath, "utf8")));
const additions = fingerprints.filter((fingerprint) => !baseline.has(fingerprint));
if (additions.length > 0) {
  console.error("Knip debt increased:\n" + additions.map((item) => `  - ${item}`).join("\n"));
  process.exit(1);
}

console.log(
  `Knip: no new unused files, exports, types, or dependencies (${fingerprints.length} baselined)`,
);
