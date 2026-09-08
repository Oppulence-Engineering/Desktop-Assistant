import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const flyConfig = readFileSync(new URL("../config/deployment/fly.toml", import.meta.url), "utf8");
const flyWorkflow = readFileSync(
  new URL("../../../.github/workflows/rowboat-www-fly-deploy.yml", import.meta.url),
  "utf8",
);

describe("Fly.io deployment contract", () => {
  it("builds from the monorepo root and keeps authenticated traffic warm", () => {
    expect(flyConfig).toContain('dockerfile = "../../Dockerfile"');
    expect(flyWorkflow).toContain("--local-only");
    expect(flyWorkflow).not.toContain("--remote-only");
    expect(flyConfig).toContain('auto_stop_machines = "off"');
    expect(flyConfig).toContain("auto_start_machines = false");
  });

  it("uses dependency-aware blue-green releases", () => {
    expect(flyConfig).toContain('strategy = "bluegreen"');
    expect(flyConfig).toContain('path = "/readyz"');
    expect(flyWorkflow).toContain("flyctl config validate --strict");
  });

  it("preserves the two-instance availability floor", () => {
    expect(flyWorkflow).toContain('flyctl scale count 2 --app "${FLY_APP_NAME}" --yes');
  });

  it("deploys relevant main branch changes automatically", () => {
    expect(flyWorkflow).toContain("push:");
    expect(flyWorkflow).toContain("branches: [main]");
    expect(flyWorkflow).toContain('      - "apps/rowboat-www/**"');
  });
});
