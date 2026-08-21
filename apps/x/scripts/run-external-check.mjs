#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: run-external-check.mjs <command> [...args]");
  process.exit(2);
}

const probe = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "pipe" });
if (probe.error?.code === "ENOENT") {
  const message = `${command} is not installed`;
  if (process.env.X_GAUNTLET_REQUIRE_EXTERNAL === "1") {
    console.error(`${message}; CI requires every Electron Architecture Gauntlet tool.`);
    process.exit(1);
  }
  console.warn(`${message}; skipping locally (verify:ci makes this mandatory).`);
  process.exit(0);
}

const result = spawnSync(command, args, { stdio: "inherit" });
if (result.error) {
  console.error(`${command} failed to start:`, result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
