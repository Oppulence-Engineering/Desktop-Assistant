// Background memory-indexing service (RFC 021). Until now `runMemoryIndex` was only
// reachable from the CLI `run_pipeline.ts`, so in the running app the index was never
// built. This service runs it on startup + on an interval (single-flighted +
// incremental, so an unchanged vault is a cheap no-op) and publishes working passes
// to `memoryBus` for the UI. Mirrors the other `init()` polling services (e.g.
// `knowledge/tag_notes.ts`). Wired into `apps/main/src/main.ts`.
import { runMemoryIndex } from "./index.js";
import { memoryBus } from "./bus.js";
import type { IndexStats } from "./indexer.js";
import { serviceLogger, type ServiceRunContext } from "../services/service_logger.js";

const SYNC_INTERVAL_MS = 60_000;

/** Runs one indexing pass and publishes a bus event when the pass did real work.
 *  The runner is injectable for testing. */
export async function memoryIndexTick(
  run: () => Promise<IndexStats | { disabled: true }> = runMemoryIndex,
): Promise<IndexStats | { disabled: true }> {
  const stats = await run();
  if ("disabled" in stats) return stats;
  if (stats.filesProcessed > 0 || stats.rebuilt) {
    memoryBus.publish({
      chunkCount: stats.chunkCount,
      filesProcessed: stats.filesProcessed,
      chunksNew: stats.chunksNew,
      tokens: stats.tokens,
      rebuilt: stats.rebuilt,
      durationMs: stats.durationMs,
    });
  }
  return stats;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function logMemoryTick(trigger: "startup" | "timer"): Promise<void> {
  let run: ServiceRunContext | null = null;
  try {
    run = await serviceLogger.startRun({
      service: "memory",
      trigger,
      message: "Memory index started",
    });
    const stats = await memoryIndexTick();
    const disabled = "disabled" in stats;
    const didWork = !disabled && (stats.filesProcessed > 0 || stats.rebuilt);
    await serviceLogger.log({
      type: "run_complete",
      service: run.service,
      runId: run.runId,
      level: "info",
      message: disabled
        ? "Memory index skipped: disabled"
        : didWork
          ? `Memory index complete: ${stats.filesProcessed} file${stats.filesProcessed === 1 ? "" : "s"} processed`
          : "Memory index idle",
      durationMs: Date.now() - run.startedAt,
      outcome: disabled ? "skipped" : didWork ? "ok" : "idle",
      ...(!disabled
        ? {
            summary: {
              files: stats.filesProcessed,
              chunks: stats.chunkCount,
              newChunks: stats.chunksNew,
              tokens: stats.tokens,
            },
          }
        : {}),
    });
  } catch (error) {
    if (!run) {
      run = await serviceLogger.startRun({
        service: "memory",
        trigger,
        message: "Memory index started",
      });
    }
    await serviceLogger.log({
      type: "error",
      service: run.service,
      runId: run.runId,
      level: "error",
      message: "Memory index failed",
      error: errorMessage(error),
    });
    await serviceLogger.log({
      type: "run_complete",
      service: run.service,
      runId: run.runId,
      level: "error",
      // Distinct from the error line above. Both said "Memory index failed",
      // so Data health showed the same sentence twice per run — 48 lines for
      // 24 runs — where the sibling services pair a detailed error with a
      // separate outcome ("Error processing agent notes" / "Agent notes
      // processing failed"). Duplicate lines read as two problems.
      message: "Memory index run ended with errors",
      durationMs: Date.now() - run.startedAt,
      outcome: "error",
    });
    throw error;
  }
}

/** Main entry point — runs as an independent polling service (fire-and-forget). */
export async function init(): Promise<void> {
  console.log(`[Memory] Starting Memory Indexing Service (every ${SYNC_INTERVAL_MS / 1000}s)...`);
  try {
    await logMemoryTick("startup");
  } catch (error) {
    console.error("[Memory] Initial index failed:", error);
  }
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, SYNC_INTERVAL_MS));
    try {
      await logMemoryTick("timer");
    } catch (error) {
      console.error("[Memory] Index tick failed:", error);
    }
  }
}
