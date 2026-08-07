import { WorkDir } from "../config/config.js";
import { AgentScheduleConfig, AgentScheduleEntry } from "@x/shared/dist/agent-schedule.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";
import { ensureJsonConfig, readJsonConfig } from "../config/json_config.js";

const DEFAULT_AGENT_SCHEDULES: z.infer<typeof AgentScheduleConfig>["agents"] = {};

export interface IAgentScheduleRepo {
    ensureConfig(): Promise<void>;
    getConfig(): Promise<z.infer<typeof AgentScheduleConfig>>;
    upsert(agentName: string, entry: z.infer<typeof AgentScheduleEntry>): Promise<void>;
    delete(agentName: string): Promise<void>;
}

const defaults = (): z.infer<typeof AgentScheduleConfig> => ({ agents: DEFAULT_AGENT_SCHEDULES });

export class FSAgentScheduleRepo implements IAgentScheduleRepo {
    private readonly configPath = path.join(WorkDir, "config", "agent-schedule.json");
    /** Last problem reported, so a broken file warns once and not once per read. */
    private reportedProblem: string | null = null;


    async ensureConfig(): Promise<void> {
        // Validity, not just existence. A file that parses to the wrong shape
        // used to pass this check and then throw on every read for the life of
        // the install — see config/json_config.ts.
        await ensureJsonConfig(this.configPath, AgentScheduleConfig, defaults, "AgentSchedule");
    }

    async getConfig(): Promise<z.infer<typeof AgentScheduleConfig>> {
        const { config, problem } = await readJsonConfig(this.configPath, AgentScheduleConfig, defaults);
        if (problem && problem !== this.reportedProblem) {
            console.error(`[AgentSchedule] ${this.configPath} is invalid (${problem}); using defaults.`);
        }
        this.reportedProblem = problem;
        return config;
    }

    async upsert(agentName: string, entry: z.infer<typeof AgentScheduleEntry>): Promise<void> {
        const conf = await this.getConfig();
        conf.agents[agentName] = entry;
        await fs.writeFile(this.configPath, JSON.stringify(conf, null, 2));
    }

    async delete(agentName: string): Promise<void> {
        const conf = await this.getConfig();
        delete conf.agents[agentName];
        await fs.writeFile(this.configPath, JSON.stringify(conf, null, 2));
    }
}
