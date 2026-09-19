import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import baseline from "../config/architecture/generator-baseline.json";
import {
  extractFetcherPaths,
  indexZodExports,
  loadOperationCatalog,
  pathPattern,
} from "@/scripts/generate/orval-operation";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const ALLOWED_CASTS = new Set([
  "const",
  "unknown",
  "never",
  "undefined",
  "null",
  "string",
  "number",
  "boolean",
]);

function relativeAppPath(filename: string): string {
  return path.relative(appRoot, filename).replaceAll(path.sep, "/");
}

function fetcherFiles(): string[] {
  const directory = path.join(appRoot, "hooks/queries/utils");
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => /^(fetch|mutate)-.+\.ts$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => path.join(directory, name));
}

function forbiddenCasts(source: string): string[] {
  return [...source.matchAll(/\bas\s+([A-Za-z_$][\w$]*)(\[\])?/g)].flatMap((match) => {
    const typeName = match[1];
    if (!typeName || ALLOWED_CASTS.has(typeName)) return [];
    return [match[0]];
  });
}

function importedOrvalSchemas(source: string): string[] {
  return [
    ...source.matchAll(/import\s+\{([^}]+)\}\s+from\s+"@\/lib\/api\/generated\/zod\/[^"]+"/g),
  ].flatMap((match) => {
    const names = match[1];
    if (!names) return [];
    return names
      .split(",")
      .map((part) =>
        part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim(),
      )
      .filter((name): name is string => Boolean(name));
  });
}

describe("WEB028 query-contract drift", () => {
  const legacy = new Set(baseline.legacyFetchers);

  it("keeps the pre-standard fetcher baseline on disk", () => {
    for (const filename of legacy) {
      expect(
        fs.existsSync(path.join(appRoot, filename)),
        `stale fetcher baseline: ${filename}`,
      ).toBe(true);
    }
  });

  it("forbids as-T and requires an Orval schema on new fetchers", () => {
    const zodExports = indexZodExports(path.join(appRoot, "lib/api/generated/zod"));
    for (const filename of fetcherFiles()) {
      const relative = relativeAppPath(filename);
      if (legacy.has(relative)) continue;
      const source = fs.readFileSync(filename, "utf8");
      expect(forbiddenCasts(source), `${relative} casts Orval output`).toEqual([]);
      const schemas = importedOrvalSchemas(source);
      expect(schemas.length, `${relative} must import an Orval Zod schema`).toBeGreaterThan(0);
      expect(
        schemas.some((schema) => /(?:200|201|202)Response$/.test(schema)),
        `${relative} must bind an Orval 200/201/202 response schema`,
      ).toBe(true);
      for (const schema of schemas) {
        expect(zodExports.has(schema), `${relative} imports missing ${schema}`).toBe(true);
      }
    }
  });

  it("requires new fetcher paths to match an OpenAPI BFF path", () => {
    const catalog = loadOperationCatalog(appRoot);
    const known = new Set(catalog.paths().map((entry) => pathPattern(entry)));
    for (const filename of fetcherFiles()) {
      const relative = relativeAppPath(filename);
      if (legacy.has(relative)) continue;
      const source = fs.readFileSync(filename, "utf8");
      const paths = extractFetcherPaths(source);
      expect(paths.length, `${relative} has no BFF path`).toBeGreaterThan(0);
      for (const fetched of paths) {
        expect(known.has(fetched), `${relative} path ${fetched} is not an OpenAPI BFF path`).toBe(
          true,
        );
      }
    }
  });
});
