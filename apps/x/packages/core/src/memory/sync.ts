// Background memory-indexing service (RFC 021). Until now `runMemoryIndex` was only
// reachable from the CLI `run_pipeline.ts`, so in the running app the index was never
// built. This service runs it on startup + on an interval (single-flighted +
// incremental, so an unchanged vault is a cheap no-op) and publishes working passes
// to `memoryBus` for the UI. Mirrors the other `init()` polling services (e.g.
// `knowledge/tag_notes.ts`). Wired into `apps/main/src/main.ts`.
import { runMemoryIndex } from './index.js';
import { memoryBus } from './bus.js';
import type { IndexStats } from './indexer.js';

const SYNC_INTERVAL_MS = 60_000;

/** Runs one indexing pass and publishes a bus event when the pass did real work.
 *  The runner is injectable for testing. */
export async function memoryIndexTick(
    run: () => Promise<IndexStats | { disabled: true }> = runMemoryIndex,
): Promise<void> {
    const stats = await run();
    if ('disabled' in stats) return;
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
}

/** Main entry point — runs as an independent polling service (fire-and-forget). */
export async function init(): Promise<void> {
    console.log(`[Memory] Starting Memory Indexing Service (every ${SYNC_INTERVAL_MS / 1000}s)...`);
    try {
        await memoryIndexTick();
    } catch (error) {
        console.error('[Memory] Initial index failed:', error);
    }
    for (;;) {
        await new Promise((resolve) => setTimeout(resolve, SYNC_INTERVAL_MS));
        try {
            await memoryIndexTick();
        } catch (error) {
            console.error('[Memory] Index tick failed:', error);
        }
    }
}
