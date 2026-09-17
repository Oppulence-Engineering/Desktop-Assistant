import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type HookCommand = {
  glob?: string[];
  run?: string;
};

type LefthookConfig = {
  "pre-commit"?: {
    commands?: Record<string, HookCommand>;
  };
};

const repositoryRoot = new URL("../../../", import.meta.url);

describe("generated API contract drift protection", () => {
  it("regenerates web contracts as part of the canonical API generation pipeline", () => {
    const makefile = readFileSync(new URL("apps/rowboat-api/Makefile", repositoryRoot), "utf8");

    expect(makefile).toMatch(
      /^generate: ent-generate proto-generate gql-generate sdk-generate www-contracts-generate$/m,
    );
    expect(makefile).toMatch(
      /^contract-generate: ent-generate gql-generate sdk-generate www-contracts-generate$/m,
    );
    expect(makefile).toContain('npm --prefix "$(WWW_DIR)" run contracts:generate');
    expect(makefile).toContain("../rowboat-www/lib/api/generated");
  });

  it("runs generation and drift detection before contract changes can be committed", () => {
    const config = parse(
      readFileSync(new URL("lefthook.yml", repositoryRoot), "utf8"),
    ) as LefthookConfig;
    const commands = config["pre-commit"]?.commands;
    const codegen = commands?.["rowboat-api-contract-drift"];
    const drift = commands?.["rowboat-www-contract-drift"];

    expect(codegen?.glob).toContain("apps/rowboat-api/api/openapi.json");
    expect(codegen?.glob).toContain("apps/rowboat-api/internal/openapidoc/**/*.go");
    expect(codegen?.run).toBe("make contract-generate-check");
    expect(drift?.glob).toEqual(
      expect.arrayContaining([
        "apps/rowboat-api/api/openapi.json",
        "apps/rowboat-www/config/contracts/**",
        "apps/rowboat-www/lib/api/generated/**",
      ]),
    );
    expect(drift?.run).toBe("npm --prefix apps/rowboat-www run contracts:check");
  });
});
