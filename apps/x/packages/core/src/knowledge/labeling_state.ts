import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';

const STATE_FILE = path.join(WorkDir, 'labeling_state.json');

export interface LabelingState {
    processedFiles: Record<string, { labeledAt: string }>;
    /**
     * Per-file failure history, so a file the agent cannot label is not retried
     * forever.
     *
     * Only successes used to be recorded, which meant anything that failed came
     * back on the very next poll — every 15 seconds, indefinitely. Measured on a
     * real workspace: 1,342 files the agent never managed to label, re-sent at
     * ~30k input tokens per 15-file batch, is ~21,600 credits for one pass
     * against a 10,000/day allowance. The account was exhausted twice over by a
     * single sweep, and the sweep restarted immediately.
     */
    failures?: Record<string, { count: number; lastAttemptAt: string }>;
    lastRunTime: string;
}

/** Give up on a file after this many failed attempts. */
export const MAX_LABEL_ATTEMPTS = 5;

const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a file is eligible for another attempt.
 *
 * Exponential backoff rather than a bare attempt cap: most failures here are
 * transient (an expired bearer, an exhausted balance, a 502 from the vendor),
 * and those files should come back — just not four times a minute.
 */
export function shouldAttempt(
    filePath: string,
    state: LabelingState,
    now: number = Date.now(),
): boolean {
    const failure = state.failures?.[filePath];
    if (!failure) return true;
    if (failure.count >= MAX_LABEL_ATTEMPTS) return false;
    const wait = Math.min(BACKOFF_BASE_MS * 2 ** (failure.count - 1), BACKOFF_CAP_MS);
    return now - new Date(failure.lastAttemptAt).getTime() >= wait;
}

/** Record that an attempt on `filePath` did not produce a labeled file. */
export function markAttemptFailed(
    filePath: string,
    state: LabelingState,
    now: Date = new Date(),
): void {
    state.failures ??= {};
    const prior = state.failures[filePath]?.count ?? 0;
    state.failures[filePath] = { count: prior + 1, lastAttemptAt: now.toISOString() };
}

/** Files that have exhausted their attempts and are no longer retried. */
export function abandonedFiles(state: LabelingState): string[] {
    return Object.entries(state.failures ?? {})
        .filter(([, f]) => f.count >= MAX_LABEL_ATTEMPTS)
        .map(([path]) => path);
}

export function loadLabelingState(): LabelingState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch (error) {
            console.error('Error loading labeling state:', error);
        }
    }

    return {
        processedFiles: {},
        lastRunTime: new Date(0).toISOString(),
    };
}

export function saveLabelingState(state: LabelingState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving labeling state:', error);
        throw error;
    }
}

export function markFileAsLabeled(filePath: string, state: LabelingState): void {
    state.processedFiles[filePath] = {
        labeledAt: new Date().toISOString(),
    };
    // A file that eventually succeeded carries no failure history forward.
    delete state.failures?.[filePath];
}

export function resetLabelingState(): void {
    const emptyState: LabelingState = {
        processedFiles: {},
        failures: {},
        lastRunTime: new Date().toISOString(),
    };
    saveLabelingState(emptyState);
}
