import { writeJsonAtomic } from "../filesystem/atomic_write.js";
import { WorkDir } from "../config/config.js";
import { AgentScheduleState, AgentScheduleStateEntry } from "@x/shared/dist/agent-schedule-state.js";
import path from "path";
import z from "zod";
import { ensureJsonConfig, readJsonConfig } from "../config/json_config.js";

const DEFAULT_AGENT_SCHEDULE_STATE: z.infer<typeof AgentScheduleState>["agents"] = {};

export interface IAgentScheduleStateRepo {
    ensureState(): Promise<void>;
    getState(): Promise<z.infer<typeof AgentScheduleState>>;
    getAgentState(agentName: string): Promise<z.infer<typeof AgentScheduleStateEntry> | null>;
    updateAgentState(agentName: string, entry: Partial<z.infer<typeof AgentScheduleStateEntry>>): Promise<void>;
    setAgentState(agentName: string, entry: z.infer<typeof AgentScheduleStateEntry>): Promise<void>;
    deleteAgentState(agentName: string): Promise<void>;
}

const defaults = (): z.infer<typeof AgentScheduleState> => ({ agents: DEFAULT_AGENT_SCHEDULE_STATE });

export class FSAgentScheduleStateRepo implements IAgentScheduleStateRepo {
    private readonly statePath = path.join(WorkDir, "config", "agent-schedule-state.json");
    /** Last problem reported, so a broken file warns once and not once per read. */
    private reportedProblem: string | null = null;


    async ensureState(): Promise<void> {
        // Validity, not just existence. A file that parses to the wrong shape
        // used to pass this check and then throw on every read for the life of
        // the install — see config/json_config.ts.
        await ensureJsonConfig(this.statePath, AgentScheduleState, defaults, "AgentScheduleState");
    }

    async getState(): Promise<z.infer<typeof AgentScheduleState>> {
        const { config, problem } = await readJsonConfig(this.statePath, AgentScheduleState, defaults);
        if (problem && problem !== this.reportedProblem) {
            console.error(`[AgentScheduleState] ${this.statePath} is invalid (${problem}); using defaults.`);
        }
        this.reportedProblem = problem;
        return config;
    }

    async getAgentState(agentName: string): Promise<z.infer<typeof AgentScheduleStateEntry> | null> {
        const state = await this.getState();
        return state.agents[agentName] ?? null;
    }

    async updateAgentState(agentName: string, entry: Partial<z.infer<typeof AgentScheduleStateEntry>>): Promise<void> {
        const state = await this.getState();
        const existing = state.agents[agentName] ?? {
            status: "scheduled" as const,
            startedAt: null,
            lastRunAt: null,
            nextRunAt: null,
            lastError: null,
            runCount: 0,
        };
        state.agents[agentName] = { ...existing, ...entry };
        // Atomic — and this is the highest-frequency config write in the app
        // (per-run counters), so the torn-write window is not theoretical.
        await writeJsonAtomic(this.statePath, state);
    }

    async setAgentState(agentName: string, entry: z.infer<typeof AgentScheduleStateEntry>): Promise<void> {
        const state = await this.getState();
        state.agents[agentName] = entry;
        // Atomic — and this is the highest-frequency config write in the app
        // (per-run counters), so the torn-write window is not theoretical.
        await writeJsonAtomic(this.statePath, state);
    }

    async deleteAgentState(agentName: string): Promise<void> {
        const state = await this.getState();
        delete state.agents[agentName];
        // Atomic — and this is the highest-frequency config write in the app
        // (per-run counters), so the torn-write window is not theoretical.
        await writeJsonAtomic(this.statePath, state);
    }
}
