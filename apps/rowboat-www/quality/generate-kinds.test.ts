import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generate, parseGenerateArguments } from "@/scripts/generate";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "oppulence-gen-"));
  temporaryRoots.push(root);
  return root;
}

function relatives(root: string, files: { path: string }[]): string[] {
  return files.map((file) => path.relative(root, file.path));
}

describe("WEB027 growth-standard generators", () => {
  it("parses kinds with Zod and rejects unknown flags", () => {
    expect(() => parseGenerateArguments(["--name", "agent-card"])).toThrow(/Usage/);
    expect(() =>
      parseGenerateArguments([
        "component",
        "--kind",
        "feature",
        "--domain",
        "agents",
        "--name",
        "card",
        "--force",
      ]),
    ).toThrow(/Unknown generator argument/);
    expect(() => parseGenerateArguments(["store", "--name", "user-session"])).toThrow(/session/);
    expect(parseGenerateArguments(["page", "--route", "forecasts"]).kind).toBe("page");
  });

  it("generates a Zod-only schema module", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "schema",
      owner: "feature",
      domain: "agents",
      name: "agent-card",
      fields: [{ name: "label", type: "string" }],
      root,
    });
    const schema = await readFile(
      files.find((file) => file.path.endsWith("agent-card.schema.ts"))?.path ?? "",
      "utf8",
    );
    expect(schema).toContain("export const AgentCardPropsSchema");
    expect(schema).toContain("z.infer<typeof AgentCardPropsSchema>");
    expect(schema).not.toMatch(/export type AgentCard = \{/);
    expect(relatives(root, files).some((file) => file.endsWith(".lit.ts"))).toBe(true);
  });

  it("generates a living interface template", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "lit",
      owner: "feature",
      domain: "agents",
      name: "agent-card",
      summary: "Compact agent identity.",
      root,
    });
    const lit = await readFile(files[0].path, "utf8");
    expect(files[0].path).toContain("agent-card.lit.ts");
    expect(lit).toContain("AgentCardLitSchema");
    expect(lit).toContain("Compact agent identity.");
  });

  it("generates a product page skeleton without touching the dashboard island", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "page",
      route: "forecasts",
      title: "Forecasts",
      root,
    });
    const relative = relatives(root, files);
    expect(relative).toContain("app/(product)/app/forecasts/page.tsx");
    expect(relative).toContain("app/(product)/app/forecasts/loading.tsx");
    expect(relative).toContain("app/(product)/app/forecasts/error.tsx");
    expect(relative).toContain("app/(product)/app/forecasts/search-params.ts");
    expect(relative).toContain(
      "app/(product)/app/forecasts/_components/forecasts-panel/forecasts-panel.tsx",
    );
    const page = await readFile(
      files.find((file) => file.path.endsWith(`${path.sep}page.tsx`))?.path ?? "",
      "utf8",
    );
    const search = await readFile(
      files.find((file) => file.path.endsWith("search-params.ts"))?.path ?? "",
      "utf8",
    );
    expect(page).not.toContain('"use client"');
    expect(page).not.toContain("product-dashboard-client");
    expect(search).toContain("ForecastsSearchParamsSchema");
    expect(search).toContain("z.infer<typeof ForecastsSearchParamsSchema>");
  });

  it("generates a lib helper, hook trio, store, and story", async () => {
    const root = await temporaryRoot();
    const lib = await generate({
      kind: "lib",
      domain: "revenue",
      name: "format-money",
      root,
    });
    const hook = await generate({
      kind: "hook",
      name: "report-preview",
      path: "/revenue-leak-scans/:id",
      orvalSchema: "GetRevenueLeakScan200Response",
      orvalImport: "@/lib/api/generated/zod/revenue/revenue",
      root,
    });
    const store = await generate({
      kind: "store",
      name: "canvas-viewport",
      domain: "workflows",
      root,
    });
    const story = await generate({
      kind: "story",
      name: "agent-card",
      ownership: "feature",
      domain: "agents",
      root,
    });

    const libSource = await readFile(
      lib.find((file) => file.path.endsWith("format-money.ts"))?.path ?? "",
      "utf8",
    );
    const fetchSource = await readFile(
      hook.find((file) => file.path.endsWith("fetch-report-preview.ts"))?.path ?? "",
      "utf8",
    );
    const storeSource = await readFile(
      store.find((file) => file.path.endsWith(`${path.sep}store.ts`))?.path ?? "",
      "utf8",
    );

    expect(libSource).toContain("FormatMoneyInputSchema.parse");
    expect(libSource).not.toContain('from "react"');
    expect(fetchSource).toContain("requestJson");
    expect(fetchSource).toContain("GetRevenueLeakScan200Response");
    expect(fetchSource).toContain("@oppulence-gen");
    expect(fetchSource).toContain("encodeURIComponent(id)");
    expect(fetchSource).not.toContain(" as ");
    expect(relatives(root, hook)).toContain("hooks/queries/utils/prefetch-report-preview.ts");
    expect(relatives(root, hook)).toContain("hooks/queries/utils/fetch-report-preview.test.ts");
    expect(relatives(root, hook).some((file) => file.endsWith("report-preview.schema.ts"))).toBe(
      false,
    );
    expect(storeSource).toContain('import { create } from "zustand"');
    expect(storeSource).toContain("CanvasViewportStateSchema.parse");
    expect(relatives(root, story)[0]).toBe(
      "components/features/agents/agent-card/agent-card.stories.tsx",
    );
  });

  it("composes a feature from the atomic kinds", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "feature",
      domain: "forecasts",
      route: "forecasts",
      name: "forecasts",
      title: "Forecasts",
      withLib: true,
      storeName: "forecast-pan",
      root,
    });
    const relative = relatives(root, files);
    expect(relative).toContain("app/(product)/app/forecasts/page.tsx");
    expect(relative).toContain("lib/forecasts/forecasts.ts");
    expect(relative).toContain("stores/forecast-pan/store.ts");
    expect(relative.some((file) => file.includes("product-dashboard-client"))).toBe(false);
  });

  it("refuses a hook without an Orval contract", async () => {
    await expect(
      generate({
        kind: "hook",
        name: "report-preview",
        path: "/revenue-leak-scans/:id",
        root: await temporaryRoot(),
      }),
    ).rejects.toThrow(/Orval/);
  });

  it("resolves --operation from the Go OpenAPI contract", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "hook",
      operation: "listConnectors",
      root,
    });
    const fetchSource = await readFile(
      files.find((file) => file.path.endsWith("fetch-list-connectors.ts"))?.path ?? "",
      "utf8",
    );
    expect(fetchSource).toContain("ListConnectors200Response");
    expect(fetchSource).toContain("@/lib/api/generated/zod/connectors/connectors");
    expect(fetchSource).toContain('"/connectors"');
    expect(relatives(root, files)).toContain("hooks/queries/utils/prefetch-list-connectors.ts");
    const fetchTest = await readFile(
      files.find((file) => file.path.endsWith("fetch-list-connectors.test.ts"))?.path ?? "",
      "utf8",
    );
    expect(fetchTest).toContain("getListConnectorsResponseMock");
    expect(fetchTest).toContain("ListConnectors200Response.parse");
  });

  it("binds Orval query params onto the generated fetcher", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "hook",
      operation: "listRevenueActions",
      root,
    });
    const fetchSource = await readFile(
      files.find((file) => file.path.endsWith("fetch-list-revenue-actions.ts"))?.path ?? "",
      "utf8",
    );
    expect(fetchSource).toContain("ListRevenueActionsQueryParams");
    expect(fetchSource).toContain("withQueryString");
    expect(fetchSource).toContain("z.infer<typeof ListRevenueActionsQueryParams>");
    expect(fetchSource).not.toContain(" as ");
  });

  it("generates search-params from --fields or the operation query schema", async () => {
    const fieldsRoot = await temporaryRoot();
    const fieldsPage = await generate({
      kind: "page",
      route: "forecasts",
      title: "Forecasts",
      fields: [{ name: "tab", type: "string" }],
      root: fieldsRoot,
    });
    const fieldsSearch = await readFile(
      fieldsPage.find((file) => file.path.endsWith("search-params.ts"))?.path ?? "",
      "utf8",
    );
    expect(fieldsSearch).toContain("tab: z.string().min(1).optional()");
    expect(fieldsSearch).toContain("parseAsString");
    expect(fieldsSearch).not.toContain("q:");

    const operationRoot = await temporaryRoot();
    const operationPage = await generate({
      kind: "page",
      route: "queue",
      title: "Queue",
      operation: "listRevenueActions",
      root: operationRoot,
    });
    const operationSearch = await readFile(
      operationPage.find((file) => file.path.endsWith("search-params.ts"))?.path ?? "",
      "utf8",
    );
    expect(operationSearch).toContain("queueStatus");
    expect(operationSearch).toContain("limit: z.number().optional()");
    expect(operationSearch).toContain("parseAsInteger");
  });

  it("generates a mutation against an Orval write operation", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "mutation",
      operation: "createRevenueAction",
      invalidate: "list-revenue-actions",
      root,
    });
    const mutateSource = await readFile(
      files.find((file) => file.path.endsWith("mutate-create-revenue-action.ts"))?.path ?? "",
      "utf8",
    );
    const hookSource = await readFile(
      files.find((file) => file.path.endsWith(`${path.sep}use-create-revenue-action.ts`))?.path ??
        "",
      "utf8",
    );
    expect(mutateSource).toContain("CreateRevenueAction201Response");
    expect(mutateSource).toContain("CreateRevenueActionBody");
    expect(mutateSource).toContain('method: "POST"');
    expect(mutateSource).toContain('"/revenue-actions"');
    expect(hookSource).toContain("useMutation");
    expect(hookSource).toContain("listRevenueActionsKeys");
  });

  it("wires prefetch into a page when --operation is set", async () => {
    const root = await temporaryRoot();
    const files = await generate({
      kind: "page",
      route: "connectors",
      title: "Connectors",
      operation: "listConnectors",
      root,
    });
    const relative = relatives(root, files);
    expect(relative).toContain("app/(product)/app/connectors/prefetch.ts");
    expect(relative).toContain("hooks/queries/use-list-connectors.ts");
    const page = await readFile(
      files.find((file) => file.path.endsWith(`${path.sep}page.tsx`))?.path ?? "",
      "utf8",
    );
    expect(page).toContain("HydrationBoundary");
    expect(page).toContain("prefetchListConnectors");
    expect(page).not.toContain('"use client"');
  });
});
