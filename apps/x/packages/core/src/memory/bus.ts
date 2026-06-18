// In-process event bus for memory-index activity (RFC 021). The background
// indexing service (`sync.ts`) publishes a `MemoryIndexEvent` after each pass that
// did real work; the Electron main process subscribes and forwards it to the
// renderer (the `memory:indexProgress` IPC event). Mirrors `live-note/bus.ts`.

/** Emitted after an indexing pass that (re)embedded or rebuilt anything. */
export interface MemoryIndexEvent {
    /** Total chunks in the index after the pass. */
    chunkCount: number;
    /** Files (re)chunked + embedded this pass. */
    filesProcessed: number;
    /** Chunks embedded this pass. */
    chunksNew: number;
    /** Embedding tokens consumed this pass. */
    tokens: number;
    /** Whether this pass was a full rebuild. */
    rebuilt: boolean;
    /** Wall-clock of the pass, ms. */
    durationMs: number;
}

type Handler = (event: MemoryIndexEvent) => void;

class MemoryBus {
    private subs: Handler[] = [];

    publish(event: MemoryIndexEvent): void {
        for (const handler of this.subs) handler(event);
    }

    subscribe(handler: Handler): () => void {
        this.subs.push(handler);
        return () => {
            const idx = this.subs.indexOf(handler);
            if (idx >= 0) this.subs.splice(idx, 1);
        };
    }
}

export const memoryBus = new MemoryBus();
