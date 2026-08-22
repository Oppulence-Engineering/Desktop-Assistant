import { spawnSync } from "node:child_process";

const mode = process.argv[2] ?? "default";

const stages = {
  fast: ["format:check", "lint", "typecheck"],
  default: [
    "format:check",
    "lint",
    "typecheck",
    "arch",
    "contracts:check",
    "security:semgrep",
    "knip",
    "test",
    "build",
    "security:gitleaks",
    "security:osv",
  ],
  ci: [
    "format:check",
    "lint",
    "typecheck",
    "arch",
    "contracts:check",
    "security:semgrep",
    "knip",
    "test",
    "build",
    "bundle:check",
    "test:e2e",
    "lighthouse",
    "security:gitleaks",
    "security:osv",
  ],
};

const selected = stages[mode];
if (!selected) {
  console.error(`Unknown verification mode: ${mode}`);
  process.exit(2);
}

for (const stage of selected) {
  console.log(`\n[verify] ${stage}`);
  const result = spawnSync("npm", ["run", stage], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
