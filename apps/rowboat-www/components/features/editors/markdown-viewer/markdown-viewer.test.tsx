import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(import.meta.dirname, "markdown-viewer.tsx"), "utf8");

describe("MarkdownViewer", () => {
  it("keeps the named product export at the generator path", () => {
    expect(source).toContain("export function MarkdownViewer");
  });
});
