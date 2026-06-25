import { describe, it, expect } from 'vitest';
import { memoryIndexTick } from './sync.js';
import { memoryBus } from './bus.js';
import type { IndexStats } from './indexer.js';

function stats(over: Partial<IndexStats> = {}): IndexStats {
    return {
        filesProcessed: 0,
        chunksNew: 0,
        chunksReused: 0,
        chunksDeleted: 0,
        tokens: 0,
        rebuilt: false,
        paused: false,
        durationMs: 0,
        chunkCount: 0,
        ...over,
    };
}

describe('memoryIndexTick', () => {
    it('publishes a bus event when a pass did real work', async () => {
        const events: unknown[] = [];
        const unsub = memoryBus.subscribe((e) => events.push(e));
        await memoryIndexTick(async () => stats({ filesProcessed: 2, chunksNew: 3, tokens: 50, chunkCount: 9 }));
        unsub();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ filesProcessed: 2, chunksNew: 3, tokens: 50, chunkCount: 9 });
    });

    it('publishes on a rebuild even with zero files processed', async () => {
        const events: unknown[] = [];
        const unsub = memoryBus.subscribe((e) => events.push(e));
        await memoryIndexTick(async () => stats({ rebuilt: true, chunkCount: 4 }));
        unsub();
        expect(events).toHaveLength(1);
    });

    it('does not publish when nothing changed or when disabled', async () => {
        const events: unknown[] = [];
        const unsub = memoryBus.subscribe((e) => events.push(e));
        await memoryIndexTick(async () => stats()); // no work
        await memoryIndexTick(async () => ({ disabled: true }) as const);
        unsub();
        expect(events).toHaveLength(0);
    });
});
