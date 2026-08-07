import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { abandoned, clearFailure, recordFailure, shouldRetry, type RetryMap } from './retry_state.js';

const STATE_FILE = path.join(WorkDir, 'agent_notes_state.json');

export interface AgentNotesState {
    processedEmails: Record<string, { processedAt: string }>;
    processedRuns: Record<string, { processedAt: string }>;
    /**
     * Per-item failure history, keyed by email path or run filename — same
     * repair as labeling/tagging/graph. Only successes used to be recorded,
     * and this is the fastest poll of them all (10 seconds), so a batch the
     * agent could not process was re-sent to the LLM six times a minute,
     * indefinitely. Optional so existing state files load unchanged.
     */
    failures?: RetryMap;
    lastRunTime: string;
}

/** Whether a source item (email path or run file) may be attempted again. */
export function shouldAttemptSource(
    key: string,
    state: AgentNotesState,
    now: number = Date.now(),
): boolean {
    return shouldRetry(key, state.failures, now);
}

/** Record that a processing pass containing `key` failed. */
export function markSourceFailed(key: string, state: AgentNotesState, now: Date = new Date()): void {
    state.failures = recordFailure(key, state.failures, now);
}

/** Source items that have exhausted their attempts and are no longer selected. */
export function abandonedSources(state: AgentNotesState): string[] {
    return abandoned(state.failures);
}

export function loadAgentNotesState(): AgentNotesState {
    if (fs.existsSync(STATE_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            // Handle migration from older state without processedRuns
            if (!parsed.processedRuns) {
                parsed.processedRuns = {};
            }
            return parsed;
        } catch (error) {
            console.error('Error loading agent notes state:', error);
        }
    }

    return {
        processedEmails: {},
        processedRuns: {},
        lastRunTime: new Date(0).toISOString(),
    };
}

export function saveAgentNotesState(state: AgentNotesState): void {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving agent notes state:', error);
        throw error;
    }
}

export function markEmailProcessed(filePath: string, state: AgentNotesState): void {
    state.processedEmails[filePath] = {
        processedAt: new Date().toISOString(),
    };
    clearFailure(filePath, state.failures);
}

export function markRunProcessed(runFile: string, state: AgentNotesState): void {
    state.processedRuns[runFile] = {
        processedAt: new Date().toISOString(),
    };
    clearFailure(runFile, state.failures);
}

export function resetAgentNotesState(): void {
    const emptyState: AgentNotesState = {
        processedEmails: {},
        processedRuns: {},
        failures: {},
        lastRunTime: new Date().toISOString(),
    };
    saveAgentNotesState(emptyState);
}
