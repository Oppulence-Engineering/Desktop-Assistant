import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const IMPORT_FROM = /(?:^|\n)import\s+(?!type\b)[^;\n]*?from\s+["']([^"']+)["']/g;

const SERVER_SAFE_GLOBS = [
  ["hooks", "queries", "utils"],
  ["lib", "query"],
];

const SERVER_SAFE_FILES = [
  path.join(appRoot, "lib", "api", "request-json.ts"),
  path.join(appRoot, "lib", "api", "request-json.server.ts"),
];

function walk(root, predicate = () => true) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "vendor") {
        return [];
      }
      return walk(target, predicate);
    }
    return predicate(target) ? [target] : [];
  });
}

function isSource(filename) {
  return /\.(ts|tsx)$/.test(filename) && !filename.includes(".test.");
}

function isClientModule(source) {
  return /^\s*(?:'|")use client(?:'|")/.test(source);
}

function resolveImport(importer, spec) {
  if (spec.startsWith("@/")) {
    return resolveExisting(path.join(appRoot, spec.slice(2)));
  }
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return resolveExisting(path.join(path.dirname(importer), spec));
  }
  return null;
}

function resolveExisting(base) {
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    base,
  ];
  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

function serverSensitiveFiles() {
  const named = walk(path.join(appRoot, "app"), (filename) => {
    const base = path.basename(filename);
    return (
      isSource(filename) &&
      (base === "prefetch.ts" ||
        base === "search-params.ts" ||
        filename.endsWith(".server.ts") ||
        filename.endsWith(".server.tsx"))
    );
  });
  const dirs = SERVER_SAFE_GLOBS.flatMap((segments) =>
    walk(path.join(appRoot, ...segments), isSource),
  );
  return [
    ...new Set([...named, ...dirs, ...SERVER_SAFE_FILES.filter((file) => fs.existsSync(file))]),
  ];
}

const failures = [];

for (const filename of serverSensitiveFiles()) {
  const source = fs.readFileSync(filename, "utf8");
  const relative = path.relative(appRoot, filename).replaceAll(path.sep, "/");
  if (isClientModule(source)) {
    failures.push(`${relative} is a server-sensitive module but starts with "use client"`);
    continue;
  }
  for (const match of source.matchAll(IMPORT_FROM)) {
    const resolved = resolveImport(filename, match[1]);
    if (!resolved) continue;
    const imported = fs.readFileSync(resolved, "utf8");
    if (isClientModule(imported)) {
      failures.push(
        `${relative} imports client module ${path.relative(appRoot, resolved).replaceAll(path.sep, "/")}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Client-boundary import check failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("Client-boundary import check passed.");
