#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--");
const allowNodeCliInspect = arguments_.includes("--allow-node-cli-inspect");
const binaryPath = arguments_.find((argument) => !argument.startsWith("--"));
if (!binaryPath) {
  console.error(
    "Usage: pnpm fuses:verify -- [--allow-node-cli-inspect] /absolute/path/to/packaged-electron-binary",
  );
  process.exit(2);
}

const require = createRequire(import.meta.url);
const policy = require(path.resolve("apps/main/fuse-policy.cjs"));
const expectedPolicy = allowNodeCliInspect
  ? { ...policy, [FuseV1Options.EnableNodeCliInspectArguments]: true }
  : policy;
const actual = await getCurrentFuseWire(path.resolve(binaryPath));
const failures = [];

const supportedOptions = Object.keys(actual).map(Number).filter(Number.isInteger);

for (const option of supportedOptions) {
  const expected = expectedPolicy[option];
  if (typeof expected !== "boolean") {
    failures.push(
      `${FuseV1Options[option] ?? option} is supported but missing from fuse-policy.cjs`,
    );
    continue;
  }
  const expectedState = expected ? FuseState.ENABLE : FuseState.DISABLE;
  if (actual[option] !== expectedState) {
    failures.push(
      `${FuseV1Options[option]} expected ${expected ? "enabled" : "disabled"}, got ${String(actual[option])}`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    "Packaged Electron fuse policy mismatch:\n" + failures.map((item) => `  - ${item}`).join("\n"),
  );
  process.exit(1);
}

console.log("Packaged Electron fuse policy verified");
