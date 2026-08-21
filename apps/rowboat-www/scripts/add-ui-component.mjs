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
const args = process.argv.slice(2);
const allowedFlag = new Set(["--dry-run", "--diff", "--view"]);
const inspectionOnly = args.some((argument) => allowedFlag.has(argument));

if (args.length === 0) {
  console.error("Usage: npm run ui:add -- <component-name> [--dry-run|--diff|--view]");
  process.exit(2);
}
for (const argument of args) {
  if (argument.startsWith("--") && !allowedFlag.has(argument)) {
    console.error(
      `Unsupported flag: ${argument}. Overwriting shared primitives is intentionally disabled.`,
    );
    process.exit(2);
  }
  if (!argument.startsWith("--") && !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(argument)) {
    console.error(`Invalid component name: ${argument}`);
    process.exit(2);
  }
}
if (!fs.existsSync(executable)) {
  console.error("shadcn CLI is not installed; run npm ci in apps/rowboat-www");
  process.exit(2);
}

const existing = args
  .filter((argument) => !argument.startsWith("--"))
  .filter((name) => fs.existsSync(path.join(uiRoot, "src/components", `${name}.tsx`)));
if (existing.length > 0 && !inspectionOnly) {
  console.error(
    `Refusing to overwrite shared primitives: ${existing.join(", ")}. Run with --diff or --view and apply reviewed changes manually.`,
  );
  process.exit(2);
}

const result = spawnSync(executable, ["add", ...args], { cwd: uiRoot, stdio: "inherit" });
process.exit(result.status ?? 1);
