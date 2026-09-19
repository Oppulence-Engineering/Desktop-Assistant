import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * useQuery queryKey arrays must come from hooks/queries/utils factories.
 */
const INLINE_KEY_ALLOWLIST = new Set();

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "vendor" ||
        entry.name === "generated"
      ) {
        return [];
      }
      return walk(target);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.") ? [target] : [];
  });
}

const failures = [];

for (const filename of [
  ...walk(path.join(appRoot, "app")),
  ...walk(path.join(appRoot, "components")),
  ...walk(path.join(appRoot, "hooks")),
]) {
  const source = fs.readFileSync(filename, "utf8");
  if (!source.includes("useQuery(")) continue;
  const relative = path.relative(appRoot, filename).replaceAll(path.sep, "/");
  const inlineKey = /queryKey:\s*\[/.test(source);
  if (inlineKey && !INLINE_KEY_ALLOWLIST.has(relative)) {
    failures.push(`${relative}: inline queryKey array; use a factory from hooks/queries/utils`);
  }

  const inQueryHooks = relative.startsWith("hooks/queries/") && !relative.includes("/utils/");
  if (inQueryHooks) {
    if (!/staleTime:/.test(source)) {
      failures.push(`${relative}: useQuery must set a named staleTime`);
    }
    if (!/\bsignal\b/.test(source)) {
      failures.push(`${relative}: useQuery queryFn must forward AbortSignal`);
    }
  }
}

if (failures.length > 0) {
  console.error("React Query pattern check failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("React Query pattern check passed.");
