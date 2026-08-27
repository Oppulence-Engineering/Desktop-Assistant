import container from "../di/container.js";
import type { IModelConfigRepo } from "../models/repo.js";
import type { IMcpConfigRepo } from "../mcp/repo.js";
import type { IAgentScheduleRepo } from "../agent-schedule/repo.js";
import type { IAgentScheduleStateRepo } from "../agent-schedule/state-repo.js";
import { ensureSecurityConfig } from "./security.js";
import path from "path";
import { pruneRunLogs } from "../runs/repo.js";
import { reapStalePartials } from "../voice/whisper/model-manager.js";
import { WorkDir } from "./config.js";
import { backfillEntityIds } from "../knowledge/entity-identity.js";
import { ensureEntityConfig } from "../knowledge/entity-config.js";
import { resumeEntitySpineSync } from "../knowledge/entity-spine.js";

/**
 * Initialize all config files at app startup.
 * Ensures config files exist before the UI might access them.
 */
export async function initConfigs(): Promise<void> {
  // Resolve repos and explicitly call their ensureConfig methods
  const modelConfigRepo = container.resolve<IModelConfigRepo>("modelConfigRepo");
  const mcpConfigRepo = container.resolve<IMcpConfigRepo>("mcpConfigRepo");
  const agentScheduleRepo = container.resolve<IAgentScheduleRepo>("agentScheduleRepo");
  const agentScheduleStateRepo =
    container.resolve<IAgentScheduleStateRepo>("agentScheduleStateRepo");

  await Promise.all([
    modelConfigRepo.ensureConfig(),
    mcpConfigRepo.ensureConfig(),
    agentScheduleRepo.ensureConfig(),
    agentScheduleStateRepo.ensureState(),
    ensureSecurityConfig(),
    ensureEntityConfig(WorkDir),
    backfillEntityIds(WorkDir)
      .then(() => resumeEntitySpineSync(WorkDir))
      .catch((error) => {
        console.error(
          "[EntitySpine] Could not initialize entity identities or projection sync:",
          error,
        );
        return { sent: 0, remaining: 0 };
      }),
    // Startup is the natural moment: the directory only grows during a
    // session, and nothing else ever removed a run log. Best-effort — a
    // failure here must not stop the app from starting.
    pruneRunLogs()
      .then((removed) => {
        if (removed > 0) console.log(`[Runs] Pruned ${removed} run logs older than 30 days.`);
      })
      .catch((error) => console.error("[Runs] Could not prune run logs:", error)),
    // Abandoned model downloads: neither remove() nor gc() can see a .part
    // file, because a partial only reaches the ledger once it finishes.
    reapStalePartials(path.join(WorkDir, "models"))
      .then((freed) => {
        if (freed > 0) {
          console.log(`[Whisper] Reclaimed ${(freed / 1e6).toFixed(0)}MB of abandoned downloads.`);
        }
      })
      .catch((error) => console.error("[Whisper] Could not reap partial downloads:", error)),
  ]);
}
