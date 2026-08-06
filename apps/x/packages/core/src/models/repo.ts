import { ModelConfig } from "./models.js";
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

export class FSModelConfigRepo implements IModelConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "models.json");

    async ensureConfig(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await fs.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2));
        }
    }

    async getConfig(): Promise<z.infer<typeof ModelConfig>> {
        const config = await fs.readFile(this.configPath, "utf8");
        return ModelConfig.parse(JSON.parse(config));
    }

    async setConfig(config: z.infer<typeof ModelConfig>): Promise<void> {
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
        await fs.writeFile(this.configPath, JSON.stringify(toWrite, null, 2));
    }
}
