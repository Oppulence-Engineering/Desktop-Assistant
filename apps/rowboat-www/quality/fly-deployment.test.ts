import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const flyConfig = readFileSync(new URL("../config/deployment/fly.toml", import.meta.url), "utf8");
const flyWorkflow = readFileSync(
  new URL("../../../.github/workflows/rowboat-www-fly-deploy.yml", import.meta.url),
  "utf8",
);

describe("Fly.io deployment contract", () => {
  it("builds from the monorepo root and keeps authenticated traffic warm", () => {
    expect(flyConfig).toContain('dockerfile = "apps/rowboat-www/Dockerfile"');
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
});
