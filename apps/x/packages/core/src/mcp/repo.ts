import { withFileLock } from "../knowledge/file-lock.js";
import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { WorkDir } from "../config/config.js";
import { McpServerConfig, McpServerDefinition } from "@x/shared/dist/mcp.js";
import path from "path";
import z from "zod";
import { ensureJsonConfig, readJsonConfig } from "../config/json_config.js";

const DEFAULT_MCP_SERVERS = {
};

export interface IMcpConfigRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof McpServerConfig>>;
    upsert(serverName: string, config: z.infer<typeof McpServerDefinition>): Promise<void>;
    delete(serverName: string): Promise<void>;
}

const defaults = (): z.infer<typeof McpServerConfig> => ({ mcpServers: DEFAULT_MCP_SERVERS });

export class FSMcpConfigRepo implements IMcpConfigRepo {
    private readonly configPath = path.join(WorkDir, "config", "mcp.json");
    /** Last problem reported, so a broken file warns once and not once per read. */
    private reportedProblem: string | null = null;


    async ensureConfig(): Promise<void> {
        // Validity, not just existence. A file that parses to the wrong shape
        // used to pass this check and then throw on every read for the life of
        // the install — see config/json_config.ts.
        await ensureJsonConfig(this.configPath, McpServerConfig, defaults, "Mcp");
    }

    async getConfig(): Promise<z.infer<typeof McpServerConfig>> {
        const { config, problem } = await readJsonConfig(this.configPath, McpServerConfig, defaults);
        if (problem && problem !== this.reportedProblem) {
            console.error(`[Mcp] ${this.configPath} is invalid (${problem}); using defaults.`);
        }
        this.reportedProblem = problem;
        return config;
    }

    // Locked: these are reached from LLM tool calls (addMcpServer,
    // rowboat-configure-integration-mcp), so two agent runs can race, and each
    // rewrites the whole server map from a value it read first.
    async upsert(serverName: string, config: z.infer<typeof McpServerDefinition>): Promise<void> {
        return withFileLock(this.configPath, async () => {
            const conf = await this.getConfig();
            conf.mcpServers[serverName] = config;
            // Atomic: a torn mcp.json reads as defaults — every server gone.
            await writeJsonAtomic(this.configPath, conf);
        });
    }

    async delete(serverName: string): Promise<void> {
        return withFileLock(this.configPath, async () => {
            const conf = await this.getConfig();
            delete conf.mcpServers[serverName];
            await writeJsonAtomic(this.configPath, conf);
        });
    }
}
