// Straight from shared rather than via ./models.js — that module pulls in the
// AI SDK and the gateway, and the gateway imports the DI container, which
// constructs this repo. Taking the plain zod schemas keeps the config layer out
// of that cycle.
import { withFileLock } from "../knowledge/file-lock.js";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { LlmModelConfig as ModelConfig, LlmProvider as Provider } from "@x/shared/models";
import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";

export interface IModelConfigRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof ModelConfig>>;
    setConfig(config: z.infer<typeof ModelConfig>): Promise<void>;
}

// Bootstrap default, written to models.json on first run and used verbatim by
// BYOK users calling OpenAI with their own key — so this id is a bill someone
// pays. gpt-4.1-mini is the cheap tier and is what the signed-in path already
// resolves to; gpt-5.4 was several times the price for work like email
// labeling and note tagging that does not need it.
//
// Deliberately un-namespaced. Gateway ids carry a provider prefix
// ("openai/gpt-4.1-mini"); a direct OpenAI call takes the bare id. Keeping it
// bare also means honorGatewayModel() in defaults.ts still recognises it as a
// non-gateway id and maps a signed-in user onto the gateway's own default.
const defaultConfig: z.infer<typeof ModelConfig> = {
    provider: {
        flavor: "openai",
    },
    model: "gpt-4.1-mini",
};

/** Per-category overrides worth keeping when the rest of the file is unusable. */
const OVERRIDE_KEYS = [
    "knowledgeGraphModel",
    "meetingNotesModel",
    "liveNoteAgentModel",
    "autoPermissionDecisionModel",
] as const;

/**
 * Rebuild a usable config out of whatever parts of a broken models.json still
 * validate, falling back to the bootstrap default for the rest.
 *
 * An unreadable models.json used to throw out of getConfig(), and every
 * background service resolves its model through here — so a single bad file
 * meant email labeling, the knowledge graph, agent notes and memory each failed
 * on *every* poll. Seen in the wild: a models.json in a shape this app has
 * never written ({version, providers, assistantModel, taskModels}) produced
 * ~3,200 identical Zod dumps and a 10MB log rotation every half hour, with
 * nothing in the UI naming the cause. Degrading to defaults is worse than a
 * correct config and much better than no LLM at all.
 *
 * `providers` is validated on its own so BYOK credentials survive a malformed
 * top level — losing a user's API keys to a schema slip is not an acceptable
 * repair.
 */
export function salvageModelConfig(raw: unknown): z.infer<typeof ModelConfig> {
    if (typeof raw !== "object" || raw === null) {
        return { ...defaultConfig };
    }
    const source = raw as Record<string, unknown>;
    const salvaged: z.infer<typeof ModelConfig> = { ...defaultConfig };

    const provider = Provider.safeParse(source.provider);
    if (provider.success) {
        salvaged.provider = provider.data;
    } else if (typeof source.provider === "string") {
        // Configs that name the provider instead of describing it.
        const flavor = Provider.shape.flavor.safeParse(source.provider);
        if (flavor.success) {
            salvaged.provider = { flavor: flavor.data };
        }
    }

    if (typeof source.model === "string" && source.model) {
        salvaged.model = source.model;
    }

    const providers = ModelConfig.shape.providers.safeParse(source.providers);
    if (providers.success && providers.data) {
        salvaged.providers = providers.data;
    }

    const models = ModelConfig.shape.models.safeParse(source.models);
    if (models.success && models.data) {
        salvaged.models = models.data;
    }

    for (const key of OVERRIDE_KEYS) {
        const value = source[key];
        if (typeof value === "string" && value) {
            salvaged[key] = value;
        }
    }

    return salvaged;
}

/**
 * Parse models.json, never throwing. `problem` is null when the file was valid
 * as written; otherwise it describes what was wrong and `config` is the
 * salvaged stand-in.
 */
export function parseModelConfig(raw: string): {
    config: z.infer<typeof ModelConfig>;
    problem: string | null;
} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { config: { ...defaultConfig }, problem: `not valid JSON (${detail})` };
    }

    const result = ModelConfig.safeParse(parsed);
    if (result.success) {
        return { config: result.data, problem: null };
    }

    const problem = result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
    return { config: salvageModelConfig(parsed), problem };
}

export class FSModelConfigRepo implements IModelConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "models.json");
    /** Last problem reported, so a broken file warns once and not once per call. */
    private reportedProblem: string | null = null;

    async ensureConfig(): Promise<void> {
        let raw: string;
        try {
            raw = await fs.readFile(this.configPath, "utf8");
        } catch {
            await writeJsonAtomic(this.configPath, defaultConfig);
            return;
        }

        const { config, problem } = parseModelConfig(raw);
        if (!problem) {
            return;
        }

        // Startup is the one place it's safe to repair the file itself. Leaving
        // it broken means every later getConfig() re-derives the same fallback,
        // settings writes land on top of an unusable base, and the user gets no
        // durable record of what happened. Quarantine rather than overwrite —
        // the original is the only copy of whatever they meant to configure.
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const quarantinePath = `${this.configPath}.invalid-${stamp}`;
        try {
            // Rebuild-first, then swap: the old order (rename away, then write)
            // left NO config file at all if the process died between the two.
            // Writing the replacement before renaming shrinks that window to a
            // pair of renames, and the write itself is atomic.
            const rebuilt = `${this.configPath}.rebuilt-${stamp}`;
            await writeJsonAtomic(rebuilt, config);
            await fs.rename(this.configPath, quarantinePath);
            await fs.rename(rebuilt, this.configPath);
            console.error(
                `[ModelConfig] ${this.configPath} could not be read (${problem}). ` +
                    `Moved it to ${quarantinePath} and rebuilt it from the salvageable parts.`,
            );
        } catch (error) {
            // Repair is best-effort; getConfig() still degrades to the salvage.
            console.error(`[ModelConfig] Could not repair ${this.configPath}:`, error);
        }
    }

    async getConfig(): Promise<z.infer<typeof ModelConfig>> {
        const raw = await fs.readFile(this.configPath, "utf8");
        const { config, problem } = parseModelConfig(raw);
        if (problem && problem !== this.reportedProblem) {
            console.error(
                `[ModelConfig] ${this.configPath} is invalid (${problem}); ` +
                    `falling back to ${config.provider.flavor}/${config.model}.`,
            );
        }
        this.reportedProblem = problem;
        return config;
    }

    async setConfig(config: z.infer<typeof ModelConfig>): Promise<void> {
        // Locked: the merge below reads the existing providers map, and a lost
        // update drops another provider's API key.
        return withFileLock(this.configPath, async () => {
        let existingProviders: Record<string, Record<string, unknown>> = {};
        try {
            const raw = await fs.readFile(this.configPath, "utf8");
            const existing = JSON.parse(raw);
            existingProviders = existing.providers || {};
        } catch {
            // No existing config
        }

        existingProviders[config.provider.flavor] = {
            ...existingProviders[config.provider.flavor],
            apiKey: config.provider.apiKey,
            baseURL: config.provider.baseURL,
            headers: config.provider.headers,
            model: config.model,
            models: config.models,
            knowledgeGraphModel: config.knowledgeGraphModel,
            meetingNotesModel: config.meetingNotesModel,
            liveNoteAgentModel: config.liveNoteAgentModel,
            autoPermissionDecisionModel: config.autoPermissionDecisionModel,
        };

        const toWrite = { ...config, providers: existingProviders };
        // Atomic: this file carries the user's API keys; a torn write loses them.
        await writeJsonAtomic(this.configPath, toWrite);
        });
    }
}
