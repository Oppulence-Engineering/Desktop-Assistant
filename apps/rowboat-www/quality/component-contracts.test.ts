import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import architecture from "../config/architecture/component-baseline.json";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const uiRoot = path.resolve(appRoot, "../../packages/ui");

function filesBelow(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

function relativeAppPath(filename: string): string {
  return path.relative(appRoot, filename).replaceAll(path.sep, "/");
}

describe("WEB020 React component contracts", () => {
  it("keeps every product component in an explicit ownership class", () => {
    const legacy = new Set(architecture.legacyFiles);
    const rogue = filesBelow(path.join(appRoot, "components"))
      .filter((filename) => filename.endsWith(".tsx") && !filename.endsWith(".test.tsx"))
      .map(relativeAppPath)
      .filter(
        (filename) =>
          !legacy.has(filename) &&
          ![...architecture.standardPaths, ...architecture.managedPaths].some((allowed) =>
            filename.includes(allowed),
          ),
      );

    expect(rogue).toEqual([]);
    for (const filename of legacy) {
      expect(
        fs.existsSync(path.join(appRoot, filename)),
        `stale legacy component: ${filename}`,
      ).toBe(true);
    }
  });

  it("requires generated product components to keep their source and test contract", () => {
    const standardized = [
      ...filesBelow(path.join(appRoot, "components/features")),
      ...filesBelow(path.join(appRoot, "app/(product)")).filter((filename) =>
        filename.includes(`${path.sep}_components${path.sep}`),
      ),
    ].filter((filename) => filename.endsWith(".tsx") && !filename.endsWith(".test.tsx"));

    for (const filename of standardized) {
      const source = fs.readFileSync(filename, "utf8");
      const basename = path.basename(filename, ".tsx");
      expect(basename).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(source).not.toMatch(/export\s+default/);
      expect(source).toContain("data-slot=");
      if (source.startsWith('"use client"')) expect(source).toContain('import "client-only"');
      expect(fs.existsSync(filename.replace(/\.tsx$/, ".test.tsx"))).toBe(true);
    }
  });

  it("keeps shared UI primitives framework-neutral and directly importable", () => {
    const config = JSON.parse(fs.readFileSync(path.join(uiRoot, "components.json"), "utf8")) as {
      rsc?: boolean;
    };
    expect(config.rsc).toBe(true);

    for (const filename of filesBelow(path.join(uiRoot, "src/components")).filter((file) =>
      file.endsWith(".tsx"),
    )) {
      expect(path.basename(filename)).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.tsx$/);
      const source = fs.readFileSync(filename, "utf8");
      expect(source).not.toMatch(/export\s+default/);
      expect(source).not.toContain('from "@/');
    }
  });
});
