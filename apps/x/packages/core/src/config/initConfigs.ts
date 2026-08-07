import container from "../di/container.js";
import type { IModelConfigRepo } from "../models/repo.js";
import type { IMcpConfigRepo } from "../mcp/repo.js";
import type { IAgentScheduleRepo } from "../agent-schedule/repo.js";
import type { IAgentScheduleStateRepo } from "../agent-schedule/state-repo.js";
import { ensureSecurityConfig } from "./security.js";
import { pruneRunLogs } from "../runs/repo.js";

/**
 * Initialize all config files at app startup.
 * Ensures config files exist before the UI might access them.
 */
export async function initConfigs(): Promise<void> {
    // Resolve repos and explicitly call their ensureConfig methods
    const modelConfigRepo = container.resolve<IModelConfigRepo>("modelConfigRepo");
    const mcpConfigRepo = container.resolve<IMcpConfigRepo>("mcpConfigRepo");
    const agentScheduleRepo = container.resolve<IAgentScheduleRepo>("agentScheduleRepo");
    const agentScheduleStateRepo = container.resolve<IAgentScheduleStateRepo>("agentScheduleStateRepo");

    await Promise.all([
        modelConfigRepo.ensureConfig(),
        mcpConfigRepo.ensureConfig(),
        agentScheduleRepo.ensureConfig(),
        agentScheduleStateRepo.ensureState(),
        ensureSecurityConfig(),
        // Startup is the natural moment: the directory only grows during a
        // session, and nothing else ever removed a run log. Best-effort — a
        // failure here must not stop the app from starting.
        pruneRunLogs()
            .then((removed) => {
                if (removed > 0) console.log(`[Runs] Pruned ${removed} run logs older than 30 days.`);
            })
            .catch((error) => console.error("[Runs] Could not prune run logs:", error)),
    ]);
}
