import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import fs from 'fs/promises';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { SlackConfig } from './types.js';

export interface ISlackConfigRepo {
    getConfig(): Promise<SlackConfig>;
    setConfig(config: SlackConfig): Promise<void>;
}

export class FSSlackConfigRepo implements ISlackConfigRepo {
    private readonly configPath = path.join(WorkDir, 'config', 'slack.json');
    private readonly defaultConfig: SlackConfig = { enabled: false, workspaces: [] };

    constructor() {
        this.ensureConfigFile();
    }

    private async ensureConfigFile(): Promise<void> {
        try {
            await fs.access(this.configPath);
        } catch {
            await writeJsonAtomic(this.configPath, this.defaultConfig);
        }
    }

    async getConfig(): Promise<SlackConfig> {
        try {
            const content = await fs.readFile(this.configPath, 'utf8');
            const parsed = JSON.parse(content);
            return SlackConfig.parse(parsed);
        } catch {
            return this.defaultConfig;
        }
    }

    async setConfig(config: SlackConfig): Promise<void> {
        const validated = SlackConfig.parse(config);
        // Atomic: a torn file reads as { workspaces: [] } — Slack disconnected.
        await writeJsonAtomic(this.configPath, validated);
    }
}
