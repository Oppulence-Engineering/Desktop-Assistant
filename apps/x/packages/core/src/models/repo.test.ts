import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

/**
 * A broken models.json must not take every LLM feature down with it.
 *
 * Real incident: ~/.rowboat/config/models.json held a shape this app has never
 * written — {version, providers, assistantModel, taskModels} — so
 * `ModelConfig.parse` threw on every getConfig(). Every background service
 * resolves its model through that call, so email labeling, the knowledge graph
 * and agent notes failed on every poll: ~3,200 identical Zod dumps in half an
 * hour, "Recent sync issues" in the UI, and no hint that one config file was
 * the cause. The parse itself was correct; treating it as fatal was not.
 *
 * WorkDir is resolved at module load, so the env var is set before the dynamic
 * import and the module registry is reset between cases.
 */

const V2_CONFIG_FROM_THE_INCIDENT = {
  version: 2,
  providers: {
    openai: { flavor: "openai", apiKey: "byok-key", baseURL: "http://localhost:8090/v1" },
  },
  assistantModel: { provider: "rowboat", model: "google/gemini-3.5-flash" },
  taskModels: { knowledgeGraph: { provider: "rowboat", model: "google/gemini-3.1-flash-lite" } },
};

let workDir: string;
let configPath: string;

async function loadRepo() {
  vi.resetModules();
  process.env.OPPULENCE_WORKDIR = workDir;
  return import("./repo.js");
}

async function writeConfig(contents: unknown): Promise<void> {
  await fs.writeFile(
    configPath,
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
  );
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "model-config-repo-"));
  configPath = path.join(workDir, "config", "models.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.OPPULENCE_WORKDIR;
  // config.ts git-inits WorkDir/knowledge fire-and-forget on import, so the
  // tree can still be growing under us. Cleanup is housekeeping, not a check.
  await fs
    .rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    .catch(() => {});
});

describe("getConfig", () => {
  it("returns a valid config unchanged", async () => {
    const { FSModelConfigRepo } = await loadRepo();
    await writeConfig({ provider: { flavor: "anthropic", apiKey: "k" }, model: "claude-x" });

    const config = await new FSModelConfigRepo().getConfig();

    expect(config.provider).toEqual({ flavor: "anthropic", apiKey: "k" });
    expect(config.model).toBe("claude-x");
  });

  it("falls back to defaults instead of throwing on the incident's config", async () => {
    const { FSModelConfigRepo } = await loadRepo();
    await writeConfig(V2_CONFIG_FROM_THE_INCIDENT);

    const config = await new FSModelConfigRepo().getConfig();

    expect(config.provider.flavor).toBe("openai");
    expect(config.model).toBe("gpt-4.1-mini");
  });

  it("keeps BYOK credentials out of the blast radius", async () => {
    const { FSModelConfigRepo } = await loadRepo();
    await writeConfig(V2_CONFIG_FROM_THE_INCIDENT);

    const config = await new FSModelConfigRepo().getConfig();

    expect(config.providers?.openai).toMatchObject({
      apiKey: "byok-key",
      baseURL: "http://localhost:8090/v1",
    });
  });

  it("survives a file that isn't JSON at all", async () => {
    const { FSModelConfigRepo } = await loadRepo();
    await writeConfig("{ not json");

    const config = await new FSModelConfigRepo().getConfig();

    expect(config.model).toBe("gpt-4.1-mini");
  });

  it("warns once per distinct problem, not once per call", async () => {
    const { FSModelConfigRepo } = await loadRepo();
    await writeConfig(V2_CONFIG_FROM_THE_INCIDENT);
    const repo = new FSModelConfigRepo();

    await repo.getConfig();
    await repo.getConfig();
    await repo.getConfig();

    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("ensureConfig", () => {
  it("writes the bootstrap default when there is no config", async () => {
    const { FSModelConfigRepo } = await loadRepo();

    await new FSModelConfigRepo().ensureConfig();

    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual({
      provider: { flavor: "openai" },
      model: "gpt-4.1-mini",
    });
  });

  it("leaves a valid config alone", async () => {
    const { FSModelConfigRepo } = await loadRepo();
    const valid = { provider: { flavor: "google" }, model: "gemini-2.5-flash" };
    await writeConfig(valid);

    await new FSModelConfigRepo().ensureConfig();

    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual(valid);
  });

  it("quarantines an unusable config and rebuilds it in place", async () => {
    const { FSModelConfigRepo } = await loadRepo();
    await writeConfig(V2_CONFIG_FROM_THE_INCIDENT);

    await new FSModelConfigRepo().ensureConfig();

    const rebuilt = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(rebuilt.provider.flavor).toBe("openai");
    expect(rebuilt.model).toBe("gpt-4.1-mini");

    const quarantined = (await fs.readdir(path.dirname(configPath))).filter((f) =>
      f.startsWith("models.json.invalid-"),
    );
    expect(quarantined).toHaveLength(1);
    expect(
      JSON.parse(await fs.readFile(path.join(path.dirname(configPath), quarantined[0]), "utf8")),
    ).toEqual(V2_CONFIG_FROM_THE_INCIDENT);
  });
});

describe("salvageModelConfig", () => {
  it("keeps per-category overrides that are still strings", async () => {
    const { salvageModelConfig } = await loadRepo();

    const salvaged = salvageModelConfig({
      provider: { flavor: "not-a-flavor" },
      knowledgeGraphModel: "gpt-4.1-mini",
      meetingNotesModel: 42,
    });

    expect(salvaged.provider.flavor).toBe("openai");
    expect(salvaged.knowledgeGraphModel).toBe("gpt-4.1-mini");
    expect(salvaged.meetingNotesModel).toBeUndefined();
  });

  it("lifts a provider named as a bare string", async () => {
    const { salvageModelConfig } = await loadRepo();

    expect(salvageModelConfig({ provider: "anthropic", model: "claude-x" })).toMatchObject({
      provider: { flavor: "anthropic" },
      model: "claude-x",
    });
  });
});
