import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(import.meta.dirname, "shared.tsx"), "utf8");

describe("WorkspaceEmptyState", () => {
  it("keeps the named product export at the generator path", () => {
    expect(source).toContain("export function WorkspaceEmptyState");
  });
});
