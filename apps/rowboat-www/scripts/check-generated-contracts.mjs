import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const committedRoot = path.join(appRoot, "lib/api/generated");
const temporaryRoot = fs.mkdtempSync(path.join(appRoot, ".rowboat-contracts-"));
const generatedRoot = path.join(temporaryRoot, "generated");
const orvalBinary = path.join(appRoot, "node_modules/.bin/orval");

function snapshot(directory) {
  if (!fs.existsSync(directory)) return new Map();
  const output = new Map();
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (entry.isFile()) {
        const relative = path.relative(directory, absolute).replaceAll(path.sep, "/");
        output.set(relative, createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"));
      }
    }
  };
  visit(directory);
  return output;
}

try {
  const generation = spawnSync(orvalBinary, ["--config", "config/contracts/orval.config.ts"], {
    cwd: appRoot,
    env: { ...process.env, ORVAL_OUTPUT_ROOT: generatedRoot },
    stdio: "inherit",
  });
  if (generation.status !== 0) process.exit(generation.status ?? 1);

  const committed = snapshot(committedRoot);
  const generated = snapshot(generatedRoot);
  const changed = [...new Set([...committed.keys(), ...generated.keys()])].filter(
    (file) => committed.get(file) !== generated.get(file),
  );

  if (changed.length > 0) {
    console.error("WEB018 Generated OpenAPI clients are stale:");
    for (const file of changed.slice(0, 40)) console.error(`  - ${file}`);
    console.error("Run `npm run contracts:generate` and commit the generated changes.");
    process.exit(1);
  }
} finally {
  fs.rmSync(temporaryRoot, { force: true, recursive: true });
}
