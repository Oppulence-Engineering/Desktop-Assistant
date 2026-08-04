import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const rendererRoot = join(process.cwd(), "apps", "renderer", "src", "components");

const source = [
  "sidebar-content.tsx",
  "chat-sidebar.tsx",
  "home-view.tsx",
  "relationships-view.tsx",
  "meetings-view.tsx",
]
  .map((file) => readFileSync(join(rendererRoot, file), "utf8"))
  .join("\n");
const tourSource = readFileSync(join(rendererRoot, "product-tour.tsx"), "utf8");

test("every product-tour step has a renderer target marker", () => {
  const requiredTargets = [...tourSource.matchAll(/target: ["']([^"']+)["']/g)].map(
    (match) => match[1],
  );

  for (const target of requiredTargets) {
    assert.match(
      source,
      new RegExp(`data-tour-target=["']${target}["']`),
      `missing target marker: ${target}`,
    );
  }
});
