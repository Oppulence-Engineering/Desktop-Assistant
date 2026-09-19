import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import baseline from "../config/architecture/generator-baseline.json";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ignoredDirectoryNames = new Set([
  "node_modules",
  ".next",
  ".git",
  "vendor",
  "coverage",
  "dist",
  ".ignored",
]);

function filesBelow(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) return [];
      return filesBelow(path.join(root, entry.name));
    }
    return [path.join(root, entry.name)];
  });
}

function relativeAppPath(filename: string): string {
  return path.relative(appRoot, filename).replaceAll(path.sep, "/");
}

function sourceLits(): string[] {
  return ["app", "components", "hooks", "lib", "stores"]
    .flatMap((directory) => filesBelow(path.join(appRoot, directory)))
    .filter((filename) => filename.endsWith(".lit.ts"));
}

function extractQuotedStrings(block: string): string[] {
  return [...block.matchAll(/"([^"]+)"/g)].flatMap((match) => (match[1] ? [match[1]] : []));
}

type GatedUnit = {
  absolute: string;
  relative: string;
  litPath?: string;
};

function gatedProductUnits(): GatedUnit[] {
  const units: GatedUnit[] = [];

  const take = (absolute: string, litPath?: string) => {
    units.push({ absolute, relative: relativeAppPath(absolute), litPath });
  };

  for (const filename of filesBelow(path.join(appRoot, "components/features"))) {
    if (
      !filename.endsWith(".tsx") ||
      filename.endsWith(".test.tsx") ||
      filename.endsWith(".stories.tsx")
    ) {
      continue;
    }
    take(filename, filename.replace(/\.tsx$/, ".lit.ts"));
  }

  for (const filename of filesBelow(path.join(appRoot, "app/(product)/app"))) {
    const relative = relativeAppPath(filename);
    if (path.basename(filename) === "page.tsx") {
      take(
        filename,
        path.join(path.dirname(filename), `${path.basename(path.dirname(filename))}.lit.ts`),
      );
      continue;
    }
    if (
      relative.includes("/_components/") &&
      filename.endsWith(".tsx") &&
      !filename.endsWith(".test.tsx") &&
      !filename.endsWith(".stories.tsx")
    ) {
      take(filename, filename.replace(/\.tsx$/, ".lit.ts"));
    }
  }

  for (const filename of filesBelow(path.join(appRoot, "hooks/queries"))) {
    const base = path.basename(filename);
    if (
      /^use-.*\.ts$/.test(base) &&
      !base.endsWith(".lit.ts") &&
      !filename.includes(`${path.sep}utils${path.sep}`)
    ) {
      take(filename, filename.replace(/\.ts$/, ".lit.ts"));
    }
    if (
      filename.includes(`${path.sep}utils${path.sep}`) &&
      /^(fetch|mutate|prefetch)-.+\.ts$/.test(base) &&
      !base.endsWith(".test.ts")
    ) {
      take(filename);
    }
  }

  for (const filename of filesBelow(path.join(appRoot, "stores"))) {
    if (path.basename(filename) === "store.ts") {
      const siblingLit = fs
        .readdirSync(path.dirname(filename))
        .find((name) => name.endsWith(".lit.ts"));
      take(
        filename,
        siblingLit
          ? path.join(path.dirname(filename), siblingLit)
          : path.join(path.dirname(filename), "store.lit.ts"),
      );
    }
  }

  return units;
}

describe("growth-standard generator policies", () => {
  it("WEB024 keeps new product pages on the generated skeleton", () => {
    const pages = filesBelow(path.join(appRoot, "app/(product)/app"))
      .filter((filename) => path.basename(filename) === "page.tsx")
      .map(relativeAppPath);
    const legacy = new Set(baseline.productPages);
    for (const filename of legacy) {
      expect(fs.existsSync(path.join(appRoot, filename)), `stale page baseline: ${filename}`).toBe(
        true,
      );
    }

    const additions = pages.filter((filename) => !legacy.has(filename));
    for (const page of additions) {
      const directory = path.dirname(path.join(appRoot, page));
      expect(
        fs.existsSync(path.join(directory, "loading.tsx")),
        `${page} missing loading.tsx`,
      ).toBe(true);
      expect(fs.existsSync(path.join(directory, "error.tsx")), `${page} missing error.tsx`).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(directory, "search-params.ts")),
        `${page} missing search-params.ts`,
      ).toBe(true);
      const lits = fs.readdirSync(directory).filter((name) => name.endsWith(".lit.ts"));
      expect(lits, `${page} missing a living interface template`).not.toEqual([]);
    }
  });

  it("WEB025 keeps new query hooks on the fetcher/key split", () => {
    const hooks = filesBelow(path.join(appRoot, "hooks/queries"))
      .filter((filename) => /^use-.*\.ts$/.test(path.basename(filename)))
      .filter((filename) => !filename.endsWith(".lit.ts"))
      .map(relativeAppPath);
    const legacy = new Set(baseline.queryHooks);
    for (const filename of legacy) {
      expect(fs.existsSync(path.join(appRoot, filename)), `stale hook baseline: ${filename}`).toBe(
        true,
      );
    }

    for (const hook of hooks.filter((filename) => !legacy.has(filename))) {
      const source = fs.readFileSync(path.join(appRoot, hook), "utf8");
      expect(source, hook).toMatch(/hooks\/queries\/utils\/(fetch-|mutate-)/);
      expect(source, hook).toMatch(/hooks\/queries\/utils\/.+-keys/);
    }
  });

  it("WEB023 forbids naked domain types beside a lit", () => {
    const lits = sourceLits();
    const forbidden = /export\s+(type|interface)\s+[A-Za-z0-9_]+(\s*<[^>]+>)?\s*(=\s*\{|\{)/;
    const allowed = /export\s+type\s+[A-Za-z0-9_]+(\s*<[^>]+>)?\s*=\s*(z\.infer|[\w]+Fields\s*&)/;

    for (const lit of lits) {
      const directory = path.dirname(lit);
      const siblings = fs
        .readdirSync(directory)
        .filter((name) => /\.(ts|tsx)$/.test(name))
        .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
        .filter((name) => !name.endsWith(".stories.tsx") && !name.endsWith(".lit.ts"));
      for (const sibling of siblings) {
        const source = fs.readFileSync(path.join(directory, sibling), "utf8");
        const matches =
          source.match(/export\s+(type|interface)\s+[A-Za-z0-9_]+[\s\S]{0,80}/g) ?? [];
        for (const match of matches) {
          if (allowed.test(match)) continue;
          expect(
            forbidden.test(match),
            `${sibling} introduces a naked domain type:\n${match}`,
          ).toBe(false);
        }
      }
    }
  });

  it("WEB029 forbids hand-rolled product units; new files must come from npm run gen", () => {
    const legacy = new Set(baseline.ungeneratedUnits);
    for (const filename of legacy) {
      expect(
        fs.existsSync(path.join(appRoot, filename)),
        `stale ungenerated baseline: ${filename}`,
      ).toBe(true);
    }

    for (const unit of gatedProductUnits()) {
      if (legacy.has(unit.relative)) continue;
      const source = fs.readFileSync(unit.absolute, "utf8");
      expect(
        source.includes("@oppulence-gen"),
        `${unit.relative} was not created with npm run gen (missing @oppulence-gen). Scaffold with the generator; do not invent a parallel layout.`,
      ).toBe(true);
      if (unit.litPath) {
        expect(
          fs.existsSync(unit.litPath),
          `${unit.relative} is missing ${path.relative(appRoot, unit.litPath)}. Run npm run gen; do not hand-create the unit.`,
        ).toBe(true);
      }
    }
  });

  it("WEB026 keeps every lit files entry on disk", () => {
    const lits = sourceLits();
    for (const lit of lits) {
      const source = fs.readFileSync(lit, "utf8");
      const filesBlock = source.match(/files:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
      for (const relative of extractQuotedStrings(filesBlock)) {
        expect(
          fs.existsSync(path.join(appRoot, relative)),
          `${relativeAppPath(lit)} lists missing file ${relative}`,
        ).toBe(true);
      }
    }
  });
});
