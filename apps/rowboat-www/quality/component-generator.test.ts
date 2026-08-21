import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildComponentPlan,
  generateComponent,
  parseComponentArguments,
} from "@/scripts/generate-component";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "oppulence-component-generator-"));
  temporaryRoots.push(root);
  return root;
}

describe("component generator", () => {
  it("creates a server-first feature component and colocated behavior test", async () => {
    const root = await temporaryRoot();
    const files = await generateComponent({
      kind: "feature",
      domain: "agents",
      name: "agent-card",
      root,
    });

    expect(files.map((file) => path.relative(root, file.path))).toEqual([
      "components/features/agents/agent-card/agent-card.tsx",
      "components/features/agents/agent-card/agent-card.test.tsx",
    ]);
    const component = await readFile(files[0].path, "utf8");
    const test = await readFile(files[1].path, "utf8");
    expect(component).not.toContain('"use client"');
    expect(component).toContain("export type AgentCardProps");
    expect(component).toContain('data-slot="agent-card"');
    expect(test).toContain("@testing-library/react");
    expect(test).toContain('getByRole("region"');
  });

  it("adds both client boundary markers only when requested", () => {
    const [component] = buildComponentPlan({
      kind: "route",
      route: "revenue/relationships",
      name: "relationship-toolbar",
      client: true,
      root: "/tmp/contract-root",
    });

    expect(component.content).toMatch(/^"use client";\n\nimport "client-only";/);
    expect(component.path).toContain(
      "app/(product)/app/revenue/relationships/_components/relationship-toolbar",
    );
  });

  it("rejects unsafe paths, unknown flags, and overwrites", async () => {
    expect(() =>
      parseComponentArguments(["--kind", "route", "--route", "../secrets", "--name", "panel"]),
    ).toThrow(/safe kebab-case/);
    expect(() => parseComponentArguments(["--kind", "feature", "--name", "Panel"])).toThrow(
      /kebab-case/,
    );
    expect(() =>
      parseComponentArguments([
        "--kind",
        "feature",
        "--domain",
        "agents",
        "--name",
        "card",
        "--force",
      ]),
    ).toThrow(/Unknown/);

    const root = await temporaryRoot();
    const options = { kind: "feature" as const, domain: "agents", name: "agent-card", root };
    await generateComponent(options);
    await expect(generateComponent(options)).rejects.toThrow(/Refusing to overwrite/);
  });

  it("supports a side-effect-free dry run", async () => {
    const root = await temporaryRoot();
    const files = await generateComponent({
      kind: "feature",
      domain: "agents",
      name: "agent-card",
      root,
      dryRun: true,
    });
    await expect(readFile(files[0].path, "utf8")).rejects.toThrow();
  });
});
