import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Default model ids are a bill someone pays.
 *
 * Three places preselect a model before the user has chosen one: the bootstrap
 * config written to models.json on first run, the provider picker in settings,
 * and onboarding. All three feed a BYOK user's own API key, so a default that
 * drifts to the newest model quietly multiplies the cost of background work —
 * email labeling, note tagging, knowledge-graph builds — none of which needs a
 * frontier model.
 *
 * The signed-in path is separate and already curated (openai/gpt-4.1-mini via
 * the gateway); these are the ones that were left on gpt-5.x.
 *
 * Pinned by reading the sources because the values are plain literals in three
 * unrelated files, and the failure is silent: nothing breaks, it just costs
 * more.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

/** Models sanctioned as defaults. Adding to this list should be deliberate. */
const ALLOWED = ["gpt-4.1-mini", "gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4.1"];

const SOURCES: Array<{ file: string; label: string }> = [
  { file: "packages/core/src/models/repo.ts", label: "bootstrap models.json default" },
  {
    file: "apps/renderer/src/components/settings/model-settings.tsx",
    label: "settings provider picker",
  },
  {
    file: "apps/renderer/src/components/onboarding/use-onboarding-state.ts",
    label: "onboarding picker",
  },
];

describe("default OpenAI model ids", () => {
  for (const { file, label } of SOURCES) {
    it(`${label} defaults to a sanctioned model`, () => {
      const src = read(`apps/x/${file}`);
      // Only the OpenAI default — anthropic/ollama entries are chosen separately.
      const m = src.match(/openai:\s*"([^"]+)"/) ?? src.match(/model:\s*"(gpt[^"]+)"/);
      expect(m, `no OpenAI default literal found in ${file}`).not.toBeNull();
      expect(ALLOWED).toContain(m![1]);
    });
  }

  it("keeps the bootstrap default un-namespaced so the gateway guard still fires", () => {
    // honorGatewayModel() treats an id containing "/" as gateway-served and
    // passes it through. A namespaced bootstrap default would be sent verbatim
    // by a BYOK user calling OpenAI directly, where "openai/gpt-4.1-mini" is
    // not a real model id.
    const src = read("apps/x/packages/core/src/models/repo.ts");
    const m = src.match(/model:\s*"([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain("/");
  });

  it("no source preselects a gpt-5 tier model", () => {
    // The exact regression: gpt-5.4 in the bootstrap config, gpt-5.2 in both
    // pickers.
    for (const { file } of SOURCES) {
      expect(read(`apps/x/${file}`)).not.toMatch(/"gpt-5[^"]*"/);
    }
  });
});

describe("signed-in gateway defaults", () => {
  const source = read("apps/x/packages/core/src/models/defaults.ts");

  function constant(name: string): string {
    const m = source.match(new RegExp(`const ${name} = "([^"]+)"`));
    expect(m, `${name} not found`).not.toBeNull();
    return m![1];
  }

  const SIGNED_IN = [
    "SIGNED_IN_DEFAULT_MODEL",
    "SIGNED_IN_KG_MODEL",
    "SIGNED_IN_LIVE_NOTE_AGENT_MODEL",
    "SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL",
  ];

  it("all point at the same model", () => {
    // These moved together off openai/* when that leg started returning 502,
    // and they must move back together. A partial revert leaves chat on one
    // provider and labeling on another, so a provider outage takes out half the
    // product and looks like a feature bug rather than an outage.
    const values = SIGNED_IN.map(constant);
    expect(new Set(values).size, `mixed providers: ${values.join(", ")}`).toBe(1);
  });

  it("use a gateway-namespaced id", () => {
    // honorGatewayModel() treats an id without "/" as non-gateway and
    // substitutes the default — a bare id here would silently self-reference.
    for (const name of SIGNED_IN) {
      expect(constant(name)).toContain("/");
    }
  });
});
