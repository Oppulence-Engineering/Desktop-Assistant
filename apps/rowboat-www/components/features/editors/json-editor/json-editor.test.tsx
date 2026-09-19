import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(import.meta.dirname, "json-editor.tsx"), "utf8");

describe("JsonEditor", () => {
  it("keeps the named product export at the generator path", () => {
    expect(source).toContain("export function JsonEditor");
  });
});
