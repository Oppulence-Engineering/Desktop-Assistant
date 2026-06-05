import fs from 'fs/promises';
import type {
    BackgroundTask,
    BackgroundTaskArtifactSyncStateType,
    BackgroundTaskArtifactSyncType,
    BackgroundTaskRunExecutorType,
    BackgroundTaskRunStatusType,
    BackgroundTaskSignalType,
    BackgroundTaskTriggerType,
} from '@x/shared/dist/background-task.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import { getAccessToken } from '../auth/tokens.js';
import { API_URL } from '../config/env.js';
import { fetchRun } from '../runs/runs.js';
import {
    fetchTask,
    indexExists,
    listTasks,
    patchTask,
    readArtifactSync,
    taskIndexPath,
    writeArtifactSync,
} from './fileops.js';
import { runBackgroundTask, type BackgroundTaskAgentResult } from './runner.js';

const log = new PrefixLogger('BgTask:Cloud');

type RemoteTask = {
    slug: string;
    revision: number;
};

type RemoteArtifact = {
    slug?: string;
    body: string;
    revision: number;
    updatedAt?: string;
    updatedByRunId?: string;
    contentType?: string;
};

export type RemoteRun = {
    id: string;
    runId: string;
    previousRunId?: string;
    retryOfRunId?: string;
    localRunId?: string;
    slug: string;
    trigger: BackgroundTaskTriggerType;
    status: BackgroundTaskRunStatusType;
    executor: BackgroundTaskRunExecutorType;
    attempt?: number;
    model?: string;
    provider?: string;
    useCase?: string;
    subUseCase?: string;
    requestedContext?: string;
    summary?: string;
    error?: string;
    errorCode?: string;
    errorDetails?: string;
    temporalWorkflowId?: string;
    temporalRunId?: string;
    temporalStatus?: string;
    temporalStartedAt?: string | null;
    temporalClosedAt?: string | null;
    cancelRequestedAt?: string | null;
    progressPercent?: number | null;
    progressMessage?: string;
    lastHeartbeatAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    revision: number;
};

export type RemoteRunStatusView = {
    runId: string;
    slug: string;
    status: BackgroundTaskRunStatusType;
    executor: BackgroundTaskRunExecutorType;
    attempt?: number;
    temporalWorkflowId?: string;
    temporalRunId?: string;
    temporalStatus?: string;
    progressPercent?: number | null;
    progressMessage?: string;
    lastHeartbeatAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    cancelRequestedAt?: string | null;
    error?: string;
    errorCode?: string;
    errorDetails?: string;
    revision: number;
};

export type RemoteRunEvent = {
    id: string;
    seq: number;
    type?: string;
    event: unknown;
    receivedAt: string;
};

export type ListCloudRunsOptions = {
    status?: BackgroundTaskRunStatusType;
    executor?: BackgroundTaskRunExecutorType;
    limit?: number;
    cursor?: string;
};

class CloudHTTPError extends Error {
    constructor(
        readonly status: number,
        readonly body: string,
    ) {
        super(`Background task cloud sync failed: ${status}${body ? ` ${body}` : ''}`);
    }
}

const remoteRunsInFlight = new Set<string>();

function isHTTPStatus(err: unknown, status: number): boolean {
    return err instanceof CloudHTTPError && err.status === status;
}

function isCloudAuthUnavailable(err: unknown): boolean {
    return err instanceof Error
        && (err.message.includes('Not signed into Rowboat') || err.message.includes('Rowboat token expired'));
}

async function cloudFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (!res.ok) {
        throw new CloudHTTPError(res.status, await res.text().catch(() => ''));
    }
    if (res.status === 204) {
        return undefined as T;
    }
    return await res.json() as T;
}

function taskPayload(task: BackgroundTask, slug: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        slug,
        name: task.name,
        instructions: task.instructions,
        active: task.active,
        triggers: task.triggers ?? null,
        model: task.model ?? '',
        provider: task.provider ?? '',
        executionTarget: task.executionTarget ?? 'desktop',
        createdAt: task.createdAt,
    };
    if ((task.executionTarget ?? 'desktop') === 'desktop') {
        payload.lastAttemptAt = task.lastAttemptAt ?? '';
        payload.lastRunId = task.lastRunId ?? '';
        payload.lastRunAt = task.lastRunAt ?? '';
        payload.lastRunSummary = task.lastRunSummary ?? '';
        payload.lastRunError = task.lastRunError ?? '';
    }
    return payload;
}

async function getRemoteTask(slug: string): Promise<RemoteTask | null> {
    try {
        return await cloudFetch<RemoteTask>(`/v1/background-tasks/${encodeURIComponent(slug)}`);
    } catch (err) {
        if (isHTTPStatus(err, 404)) return null;
        throw err;
    }
}

async function createRemoteTask(slug: string, task: BackgroundTask): Promise<RemoteTask> {
    return await cloudFetch<RemoteTask>('/v1/background-tasks', {
        method: 'POST',
        body: JSON.stringify(taskPayload(task, slug)),
    });
}

async function patchRemoteTask(slug: string, revision: number, task: BackgroundTask): Promise<RemoteTask> {
    return await cloudFetch<RemoteTask>(`/v1/background-tasks/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body: JSON.stringify({ revision, ...taskPayload(task, slug) }),
    });
}

async function readArtifactBody(slug: string): Promise<string> {
    try {
        return await fs.readFile(taskIndexPath(slug), 'utf-8');
    } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'ENOENT') return '';
        throw err;
    }
}

async function syncArtifactToCloud(slug: string): Promise<void> {
    const body = await readArtifactBody(slug);
    const artifact = await cloudFetch<RemoteArtifact>(`/v1/background-tasks/${encodeURIComponent(slug)}/artifact`);
    try {
        await cloudFetch<RemoteArtifact>(`/v1/background-tasks/${encodeURIComponent(slug)}/artifact`, {
            method: 'PUT',
            body: JSON.stringify({
                ...(artifact.revision > 0 ? { revision: artifact.revision } : {}),
                body,
            }),
        });
    } catch (err) {
        if (!isHTTPStatus(err, 409)) throw err;
        const latest = await cloudFetch<RemoteArtifact>(`/v1/background-tasks/${encodeURIComponent(slug)}/artifact`);
        await cloudFetch<RemoteArtifact>(`/v1/background-tasks/${encodeURIComponent(slug)}/artifact`, {
            method: 'PUT',
            body: JSON.stringify({
                ...(latest.revision > 0 ? { revision: latest.revision } : {}),
                body,
            }),
        });
    }
}

export async function syncTaskToCloud(slug: string): Promise<void> {
    const task = await fetchTask(slug);
    if (!task) {
        await deleteTaskFromCloud(slug);
        return;
    }

    let remote = await getRemoteTask(slug);
    let created = false;
    if (!remote) {
        try {
            remote = await createRemoteTask(slug, task);
            created = true;
        } catch (err) {
            if (!isHTTPStatus(err, 409)) throw err;
            remote = await getRemoteTask(slug);
            if (!remote) throw err;
        }
    }

    if (remote && !created) {
        try {
            remote = await patchRemoteTask(slug, remote.revision, task);
        } catch (err) {
            if (!isHTTPStatus(err, 409)) throw err;
            const latest = await getRemoteTask(slug);
            if (!latest) {
                remote = await createRemoteTask(slug, task);
            } else {
                remote = await patchRemoteTask(slug, latest.revision, task);
            }
        }
    }

    if (remote && (task.executionTarget ?? 'desktop') === 'desktop') {
        await syncArtifactToCloud(slug);
    }
}

export async function syncArtifactFromCloud(slug: string): Promise<void> {
    try {
        const artifact = await cloudFetch<RemoteArtifact>(`/v1/background-tasks/${encodeURIComponent(slug)}/artifact`);
        await fs.writeFile(taskIndexPath(slug), artifact.body ?? '', 'utf-8');
        // Record the pulled revision so the UI can detect a later "remote newer".
        await writeArtifactSync(slug, { revision: artifact.revision ?? 0, pulledAt: new Date().toISOString() });
    } catch (err) {
        // Persist the failure so the sync indicator can show "pull failed" even
        // after a reload, while preserving the last-known good revision.
        const prev = await readArtifactSync(slug);
        await writeArtifactSync(slug, {
            revision: prev?.revision ?? 0,
            pulledAt: prev?.pulledAt ?? '',
            lastError: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}

export async function getArtifactSyncState(slug: string): Promise<BackgroundTaskArtifactSyncType> {
    const artifact = await cloudFetch<RemoteArtifact>(`/v1/background-tasks/${encodeURIComponent(slug)}/artifact`);
    const remoteRevision = artifact.revision ?? 0;
    const sidecar = await readArtifactSync(slug);
    const haveIndex = await indexExists(slug);

    let state: BackgroundTaskArtifactSyncStateType;
    if (sidecar?.lastError) {
        state = 'pull_failed';
    } else if (remoteRevision <= 0) {
        // No remote artifact has been produced yet — nothing to pull.
        state = 'current';
    } else if (!sidecar || !haveIndex) {
        state = 'not_pulled';
    } else if (sidecar.revision >= remoteRevision) {
        state = 'current';
    } else {
        state = 'remote_newer';
    }

    return {
        state,
        localRevision: sidecar?.revision ?? null,
        remoteRevision,
        ...(artifact.updatedByRunId ? { updatedByRunId: artifact.updatedByRunId } : {}),
        ...(artifact.updatedAt ? { updatedAt: artifact.updatedAt } : {}),
        ...(artifact.contentType ? { contentType: artifact.contentType } : {}),
        ...(sidecar?.lastError ? { error: sidecar.lastError } : {}),
    };
}

export async function deleteTaskFromCloud(slug: string): Promise<void> {
    const remote = await getRemoteTask(slug);
    if (!remote) return;
    try {
        await cloudFetch<void>(`/v1/background-tasks/${encodeURIComponent(slug)}?revision=${remote.revision}`, {
            method: 'DELETE',
        });
    } catch (err) {
        if (!isHTTPStatus(err, 404) && !isHTTPStatus(err, 409)) throw err;
    }
}

export async function listCloudRuns(slug: string, opts: ListCloudRunsOptions = {}): Promise<{ runs: RemoteRun[]; nextCursor?: string }> {
    const query = new URLSearchParams();
    if (opts.status) query.set('status', opts.status);
    if (opts.executor) query.set('executor', opts.executor);
    if (opts.limit) query.set('limit', String(opts.limit));
    if (opts.cursor) query.set('cursor', opts.cursor);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return await cloudFetch<{ runs: RemoteRun[]; nextCursor?: string }>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs${suffix}`);
}

async function listRemoteRuns(
    slug: string,
    status?: RemoteRun['status'],
    executor?: RemoteRun['executor'],
): Promise<RemoteRun[]> {
    const body = await listCloudRuns(slug, { status, executor });
    return body.runs;
}

export type ListAllCloudRunsOptions = {
    status?: BackgroundTaskRunStatusType;
    trigger?: BackgroundTaskTriggerType;
    executor?: BackgroundTaskRunExecutorType;
    slug?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
};

/** Lists cloud runs across every task the user owns (GET /v1/background-task-runs). */
export async function listAllCloudRuns(
    opts: ListAllCloudRunsOptions = {},
): Promise<{ runs: RemoteRun[]; nextCursor?: string }> {
    const query = new URLSearchParams();
    if (opts.status) query.set('status', opts.status);
    if (opts.trigger) query.set('trigger', opts.trigger);
    if (opts.executor) query.set('executor', opts.executor);
    if (opts.slug) query.set('slug', opts.slug);
    if (opts.since) query.set('since', opts.since);
    if (opts.until) query.set('until', opts.until);
    if (opts.limit) query.set('limit', String(opts.limit));
    if (opts.cursor) query.set('cursor', opts.cursor);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return await cloudFetch<{ runs: RemoteRun[]; nextCursor?: string }>(`/v1/background-task-runs${suffix}`);
}

export async function getCloudRun(slug: string, runId: string): Promise<RemoteRun> {
    return await cloudFetch<RemoteRun>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`);
}

export async function getCloudRunStatus(slug: string, runId: string): Promise<RemoteRunStatusView> {
    return await cloudFetch<RemoteRunStatusView>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/status`);
}

export async function listCloudRunEvents(slug: string, runId: string, afterSeq?: number): Promise<RemoteRunEvent[]> {
    const query = afterSeq === undefined ? '' : `?afterSeq=${encodeURIComponent(String(afterSeq))}`;
    const body = await cloudFetch<{ events: RemoteRunEvent[] }>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/events${query}`);
    return body.events;
}

export async function triggerCloudRun(
    slug: string,
    trigger: BackgroundTaskTriggerType = 'manual',
    context?: string,
): Promise<RemoteRun> {
    await syncTaskToCloud(slug);
    const run = await cloudFetch<RemoteRun>(`/v1/background-tasks/${encodeURIComponent(slug)}/trigger`, {
        method: 'POST',
        body: JSON.stringify({
            trigger,
            ...(context ? { context } : {}),
        }),
    });
    const now = new Date().toISOString();
    const runtimePatch: Partial<BackgroundTask> = {
        lastAttemptAt: now,
        lastRunId: run.runId,
        ...(trigger === 'cron' || trigger === 'window' ? { lastRunAt: now } : {}),
    };
    await patchTask(slug, runtimePatch).catch(err => {
        log.log(`${slug} — local API-worker runtime update skipped: ${err instanceof Error ? err.message : String(err)}`);
    });
    return run;
}

export async function cancelCloudRun(slug: string, runId: string): Promise<RemoteRun> {
    return await cloudFetch<RemoteRun>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
    });
}

export async function retryCloudRun(slug: string, runId: string): Promise<RemoteRun> {
    return await cloudFetch<RemoteRun>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/retry`, {
        method: 'POST',
    });
}

/**
 * Rerun-with-same-context: a fresh `manual` run that reuses the original run's
 * requested context, with NO retry lineage. This is deliberately distinct from
 * `retryCloudRun` (which links `retryOfRunId` and bumps `attempt`) — a rerun is
 * "do this again from scratch", a retry is "this one failed, try it again".
 */
export async function rerunCloudRun(slug: string, runId: string): Promise<RemoteRun> {
    const original = await getCloudRun(slug, runId);
    return await triggerCloudRun(slug, 'manual', original.requestedContext || undefined);
}

export async function signalCloudRun(
    slug: string,
    runId: string,
    signal: BackgroundTaskSignalType,
    payload?: Record<string, unknown>,
): Promise<RemoteRun> {
    return await cloudFetch<RemoteRun>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/signal`, {
        method: 'POST',
        body: JSON.stringify({
            signal,
            ...(payload ? { payload } : {}),
        }),
    });
}

async function findRemoteRun(slug: string, runId: string): Promise<RemoteRun | null> {
    try {
        return await getCloudRun(slug, runId);
    } catch (err) {
        if (isHTTPStatus(err, 404)) return null;
        throw err;
    }
}

async function patchRemoteRun(slug: string, runId: string, revision: number, body: Record<string, unknown>): Promise<RemoteRun> {
    return await cloudFetch<RemoteRun>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ revision, ...body }),
    });
}

async function createRemoteRun(slug: string, body: Record<string, unknown>): Promise<RemoteRun> {
    return await cloudFetch<RemoteRun>(`/v1/background-tasks/${encodeURIComponent(slug)}/runs`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

async function appendRunEvents(slug: string, runId: string, localRunId: string): Promise<void> {
    const run = await fetchRun(localRunId);
    const events = run.log.map((event, seq) => ({
        seq,
        type: typeof event.type === 'string' ? event.type : undefined,
        event,
    }));
    if (events.length === 0) return;
    await cloudFetch(`/v1/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/events`, {
        method: 'POST',
        body: JSON.stringify({ events }),
    });
}

export async function syncRunToCloud(
    slug: string,
    localRunId: string,
    trigger: BackgroundTaskTriggerType,
    result?: BackgroundTaskAgentResult,
    remoteRunId = localRunId,
): Promise<void> {
    const task = await fetchTask(slug);
    if (!task) return;
    await syncTaskToCloud(slug);

    const run = await fetchRun(localRunId);
    const finalStatus = result ? (result.error ? 'failed' : 'succeeded') : 'running';
    const completedAt = result ? new Date().toISOString() : undefined;

    let remote = await findRemoteRun(slug, remoteRunId);
    const runPayload = {
        runId: remoteRunId,
        localRunId,
        trigger,
        status: finalStatus,
        model: run.model,
        provider: run.provider,
        useCase: run.useCase ?? 'background_task_agent',
        subUseCase: run.subUseCase ?? trigger,
        summary: result?.summary ?? task.lastRunSummary ?? '',
        error: result?.error ?? '',
        startedAt: run.createdAt,
        ...(completedAt ? { completedAt } : {}),
    };

    if (!remote) {
        try {
            remote = await createRemoteRun(slug, runPayload);
        } catch (err) {
            if (!isHTTPStatus(err, 409)) throw err;
            remote = await findRemoteRun(slug, remoteRunId);
            if (!remote) throw err;
        }
    }

    await appendRunEvents(slug, remoteRunId, localRunId);

    if (remote.status !== finalStatus || remote.localRunId !== localRunId || result) {
        try {
            await patchRemoteRun(slug, remoteRunId, remote.revision, {
                localRunId,
                status: finalStatus,
                summary: result?.summary ?? task.lastRunSummary ?? '',
                error: result?.error ?? '',
                ...(completedAt ? { completedAt } : {}),
            });
        } catch (err) {
            if (!isHTTPStatus(err, 409)) throw err;
            const latest = await findRemoteRun(slug, remoteRunId);
            if (latest) {
                await patchRemoteRun(slug, remoteRunId, latest.revision, {
                    localRunId,
                    status: finalStatus,
                    summary: result?.summary ?? task.lastRunSummary ?? '',
                    error: result?.error ?? '',
                    ...(completedAt ? { completedAt } : {}),
                });
            }
        }
    }
}

export function syncTaskToCloudBestEffort(slug: string): void {
    void syncTaskToCloud(slug).catch(err => {
        log.log(`${slug} — task sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function deleteTaskFromCloudBestEffort(slug: string): void {
    void deleteTaskFromCloud(slug).catch(err => {
        log.log(`${slug} — delete sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function syncRunToCloudBestEffort(
    slug: string,
    localRunId: string,
    trigger: BackgroundTaskTriggerType,
    result?: BackgroundTaskAgentResult,
    remoteRunId?: string,
): void {
    void syncRunToCloud(slug, localRunId, trigger, result, remoteRunId).catch(err => {
        log.log(`${slug} — run sync skipped: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function triggerCloudRunBestEffort(
    slug: string,
    trigger: BackgroundTaskTriggerType = 'manual',
    context?: string,
): void {
    void triggerCloudRun(slug, trigger, context).catch(err => {
        log.log(`${slug} — API-worker trigger skipped: ${err instanceof Error ? err.message : String(err)}`);
    });
}

export async function processRemoteTriggers(): Promise<void> {
    const { items } = await listTasks({ limit: 10_000 });
    for (const task of items) {
        if (!task.active) continue;
        if ((task.executionTarget ?? 'desktop') !== 'desktop') continue;

        let queued: RemoteRun[];
        try {
            queued = await listRemoteRuns(task.slug, 'queued', 'desktop');
        } catch (err) {
            if (isCloudAuthUnavailable(err)) return;
            if (isHTTPStatus(err, 404)) continue;
            throw err;
        }

        for (const remote of queued) {
            if (remoteRunsInFlight.has(remote.runId)) continue;
            remoteRunsInFlight.add(remote.runId);
            try {
                try {
                    await patchRemoteRun(task.slug, remote.runId, remote.revision, {
                        status: 'running',
                        startedAt: new Date().toISOString(),
                    });
                } catch (err) {
                    if (isHTTPStatus(err, 409) || isHTTPStatus(err, 404)) continue;
                    throw err;
                }

                log.log(`${task.slug} — claiming remote trigger ${remote.runId}`);
                const result = await runBackgroundTask(
                    task.slug,
                    remote.trigger || 'manual',
                    remote.requestedContext,
                    remote.runId,
                );
                if (result.runId) {
                    await syncRunToCloud(task.slug, result.runId, remote.trigger || 'manual', result, remote.runId);
                } else {
                    const latest = await findRemoteRun(task.slug, remote.runId);
                    if (latest) {
                        await patchRemoteRun(task.slug, remote.runId, latest.revision, {
                            status: 'failed',
                            error: result.error ?? 'Remote trigger could not start locally.',
                            completedAt: new Date().toISOString(),
                        });
                    }
                }
            } catch (err) {
                log.log(`${task.slug} — remote trigger ${remote.runId} failed: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                remoteRunsInFlight.delete(remote.runId);
            }
        }
    }
}
