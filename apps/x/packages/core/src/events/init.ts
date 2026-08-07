import { PrefixLogger } from '@x/shared';
import { processPendingEvents, pruneDoneEvents } from './processor.js';
import { ensureEventDirs } from './producer.js';

export { registerConsumer } from './processor.js';
export type { EventConsumer, EventConsumerTarget, EventConsumerFireResult } from './consumer.js';
export { routeBatch } from './routing.js';
export type { RouteBatchOptions } from './routing.js';
export { createEvent } from './producer.js';

const log = new PrefixLogger('Events:Processor');
const POLL_INTERVAL_MS = 5_000; // 5 seconds — events should feel responsive

/**
 * Start the event processor's tick loop. Consumers must be registered via
 * `registerConsumer` before this is called.
 */
export async function init(): Promise<void> {
    log.log(`starting, polling every ${POLL_INTERVAL_MS / 1000}s`);
    // Both guarded like every later tick — a bare first run that threw killed
    // the processor until app restart (init() is a floating promise).
    try {
        ensureEventDirs();
        // Startup is the retention moment, matching pruneRunLogs — the only
        // other time the directory shrinks is never.
        const pruned = pruneDoneEvents();
        if (pruned > 0) log.log(`pruned ${pruned} processed events older than 7 days`);
        await processPendingEvents();
    } catch (err) {
        log.log(`initial run failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    while (true) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        try {
            await processPendingEvents();
        } catch (err) {
            log.log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
