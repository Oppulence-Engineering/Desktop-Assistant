import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { MAX_ATTEMPTS, abandoned, clearFailure, recordFailure, shouldRetry, type RetryMap } from './retry_state.js';

const STATE_FILE = path.join(WorkDir, 'note_tagging_state.json');

export interface NoteTaggingState {
    processedFiles: Record<string, { taggedAt: string }>;
    /**
     * Per-note failure history — same repair as labeling_state.ts. Only
     * successes used to be recorded, so a note the agent could not tag was
     * re-sent to the model on every 15-second poll, forever, at full token
     * cost. Optional so existing state files load unchanged.
     */
    failures?: RetryMap;
    lastRunTime: string;
}

/** Give up on a note after this many failed attempts. */
export const MAX_TAG_ATTEMPTS = MAX_ATTEMPTS;

/** Whether a note is eligible for another attempt. See retry_state.ts. */
export function shouldAttempt(
    filePath: string,
    state: NoteTaggingState,
    now: number = Date.now(),
): boolean {
    return shouldRetry(filePath, state.failures, now);
}

/** Record that an attempt on `filePath` did not produce a tagged note. */
export function markAttemptFailed(
    filePath: string,
    state: NoteTaggingState,
    now: Date = new Date(),
): void {
    state.failures = recordFailure(filePath, state.failures, now);
}

/** Notes that have exhausted their attempts and are no longer retried. */
export function abandonedNotes(state: NoteTaggingState): string[] {
    return abandoned(state.failures);
}

export function loadNoteTaggingState(): NoteTaggingState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch (error) {
            console.error('Error loading note tagging state:', error);
        }
    }

    return {
        processedFiles: {},
        lastRunTime: new Date(0).toISOString(),
    };
}

export function saveNoteTaggingState(state: NoteTaggingState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving note tagging state:', error);
        throw error;
    }
}

export function markNoteAsTagged(filePath: string, state: NoteTaggingState): void {
    state.processedFiles[filePath] = {
        taggedAt: new Date().toISOString(),
    };
    // A note that eventually succeeded carries no failure history forward.
    clearFailure(filePath, state.failures);
}

export function resetNoteTaggingState(): void {
    const emptyState: NoteTaggingState = {
        processedFiles: {},
        failures: {},
        lastRunTime: new Date().toISOString(),
    };
    saveNoteTaggingState(emptyState);
}
