import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(import.meta.dirname, "revenue-panel.tsx"), "utf8");

describe("RevenuePanel", () => {
  it("keeps the named product export at the generator path", () => {
    expect(source).toContain("export function RevenuePanel");
  });
});
