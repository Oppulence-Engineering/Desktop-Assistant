import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const UI_ROOT = path.resolve(ROOT, "../../packages/ui/src");

const FORBIDDEN_ICON_IMPORTS = ["lucide-react", "@mui/icons-material"] as const;
const ALLOWED_ICON_SURFACES = [
  path.join(ROOT, "lib/icons.tsx"),
  path.join(UI_ROOT, "lib/icons.tsx"),
] as const;

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

function findForbiddenImports(files: string[]) {
  const violations: string[] = [];

  for (const file of files) {
    if (ALLOWED_ICON_SURFACES.includes(file as (typeof ALLOWED_ICON_SURFACES)[number])) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    for (const lib of FORBIDDEN_ICON_IMPORTS) {
      if (source.includes(`from "${lib}"`) || source.includes(`from '${lib}'`)) {
        violations.push(`${path.relative(ROOT, file)} imports ${lib}`);
      }
    }
  }

  return violations;
}

describe("icon library policy", () => {
  it("uses Phosphor via lib/icons wrappers, not lucide-react or MUI icons", () => {
    const files = [...collectSourceFiles(ROOT), ...collectSourceFiles(UI_ROOT)];
    expect(findForbiddenImports(files)).toEqual([]);
  });

  it("declares @phosphor-icons/react in rowboat-www and @oppulence/ui", () => {
    const wwwPkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const uiPkg = JSON.parse(readFileSync(path.join(UI_ROOT, "../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(wwwPkg.dependencies?.["@phosphor-icons/react"]).toBeTruthy();
    expect(uiPkg.dependencies?.["@phosphor-icons/react"]).toBeTruthy();
    expect(wwwPkg.dependencies?.["lucide-react"]).toBeUndefined();
    expect(uiPkg.dependencies?.["lucide-react"]).toBeUndefined();
  });
});
