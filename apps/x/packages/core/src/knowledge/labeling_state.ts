import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { MAX_ATTEMPTS, abandoned, clearFailure, recordFailure, shouldRetry, type RetryMap } from './retry_state.js';

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
    failures?: RetryMap;
    lastRunTime: string;
}

/** Give up on a file after this many failed attempts. */
export const MAX_LABEL_ATTEMPTS = MAX_ATTEMPTS;

/** Whether a file is eligible for another attempt. See retry_state.ts. */
export function shouldAttempt(
    filePath: string,
    state: LabelingState,
    now: number = Date.now(),
): boolean {
    return shouldRetry(filePath, state.failures, now);
}

/** Record that an attempt on `filePath` did not produce a labeled file. */
export function markAttemptFailed(
    filePath: string,
    state: LabelingState,
    now: Date = new Date(),
): void {
    state.failures = recordFailure(filePath, state.failures, now);
}

/** Files that have exhausted their attempts and are no longer retried. */
export function abandonedFiles(state: LabelingState): string[] {
    return abandoned(state.failures);
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
    clearFailure(filePath, state.failures);
}

export function resetLabelingState(): void {
    const emptyState: LabelingState = {
        processedFiles: {},
        failures: {},
        lastRunTime: new Date().toISOString(),
    };
    saveLabelingState(emptyState);
}
