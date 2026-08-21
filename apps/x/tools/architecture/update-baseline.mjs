#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const baselinePath = path.join(root, "architecture-baseline.json");
const sourceRoots = ["apps/main/src", "packages/core/src"];

function rootIdentifier(expression) {
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : null;
}

function collect(source, relative) {
  const counts = {
    containerResolve: 0,
    unsafeFsWrites: 0,
    unboundedPollers: 0,
    unvalidatedFsReads: 0,
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const rootName = rootIdentifier(callee);
        const method = callee.name.text;
        if (rootName === "container" && method === "resolve") counts.containerResolve += 1;
        if (
          (rootName === "fs" || rootName === "fsp") &&
          ["writeFile", "writeFileSync", "appendFile", "appendFileSync"].includes(method)
        ) {
          counts.unsafeFsWrites += 1;
        }
      } else if (ts.isIdentifier(callee) && callee.text === "setInterval") {
        counts.unboundedPollers += 1;
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        rootIdentifier(callee) === "JSON" &&
        callee.name.text === "parse"
      ) {
        const argument = node.arguments[0];
        const awaited = argument && ts.isAwaitExpression(argument) ? argument.expression : argument;
        if (
          awaited &&
          ts.isCallExpression(awaited) &&
          ts.isPropertyAccessExpression(awaited.expression) &&
          awaited.expression.name.text === "readFile"
        ) {
          counts.unvalidatedFsReads += 1;
        }
      }
    }
    if (ts.isWhileStatement(node) && node.expression.kind === ts.SyntaxKind.TrueKeyword) {
      counts.unboundedPollers += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => [key, { [relative]: count }]),
  );
}

async function filesUnder(relativeRoot) {
  const output = [];
  const walk = async (relativeDir) => {
    for (const entry of await fs.readdir(path.join(root, relativeDir), { withFileTypes: true })) {
      const relative = path.posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (
        /\.(?:ts|tsx)$/.test(entry.name) &&
        !/\.(?:test|spec|testkit)\.tsx?$/.test(entry.name)
      ) {
        output.push(relative);
      }
    }
  };
  await walk(relativeRoot);
  return output;
}

const current = {
  containerResolve: {},
  unsafeFsWrites: {},
  unboundedPollers: {},
  unvalidatedFsReads: {},
};
for (const sourceRoot of sourceRoots) {
  for (const relative of await filesUnder(sourceRoot)) {
    const text = await fs.readFile(path.join(root, relative), "utf8");
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
    const collected = collect(source, relative);
    for (const category of Object.keys(current))
      Object.assign(current[category], collected[category]);
  }
}

if (process.argv.includes("--write")) {
  await fs.writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${path.relative(root, baselinePath)}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
} catch (error) {
  console.error(`Cannot read ${path.relative(root, baselinePath)}:`, error);
  process.exit(1);
}

const failures = [];
for (const [category, entries] of Object.entries(current)) {
  for (const [file, count] of Object.entries(entries)) {
    const limit = baseline[category]?.[file] ?? 0;
    if (count > limit) failures.push(`${category}: ${file} has ${count}, baseline allows ${limit}`);
  }
}

if (failures.length > 0) {
  console.error(
    "Architecture debt increased:\n" + failures.map((failure) => `  - ${failure}`).join("\n"),
  );
  console.error(
    "Remove the new violations. Update the baseline only for an explicitly approved migration exception.",
  );
  process.exit(1);
}

console.log("Architecture baseline: no debt growth");
