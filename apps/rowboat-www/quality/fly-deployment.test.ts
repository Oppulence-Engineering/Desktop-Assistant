import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const flyConfig = readFileSync(new URL("../config/deployment/fly.toml", import.meta.url), "utf8");
const flyWorkflow = readFileSync(
  new URL("../../../.github/workflows/rowboat-www-deploy.yml", import.meta.url),
  "utf8",
);

describe("Fly.io deployment contract", () => {
  it("builds from the monorepo root and keeps authenticated traffic warm", () => {
    expect(flyConfig).toContain('dockerfile = "../../Dockerfile"');
    expect(flyConfig).toContain('auto_stop_machines = "off"');
    expect(flyConfig).toContain("auto_start_machines = false");
  });

  it("uses dependency-aware blue-green releases", () => {
    expect(flyConfig).toContain('strategy = "bluegreen"');
    expect(flyConfig).toContain('path = "/readyz"');
    expect(flyWorkflow).toContain("flyctl config validate --strict");
  });

  it("preserves the two-instance availability floor", () => {
    expect(flyWorkflow).toContain("flyctl scale count 2");
    expect(flyWorkflow).toContain("--region iad,sjc");
    expect(flyWorkflow).toContain("--max-per-region 1");
  });

  it("deploys production only and cannot recreate Kubernetes namespaces", () => {
    expect(flyWorkflow).toContain("branches: [main]");
    expect(flyWorkflow).toContain("ROWBOAT_WWW_FLY_API_TOKEN");
    expect(flyWorkflow).not.toContain("rowboat-staging");
    expect(flyWorkflow).not.toContain("kubectl");
    expect(flyWorkflow).not.toContain("helm upgrade");
  });
});
