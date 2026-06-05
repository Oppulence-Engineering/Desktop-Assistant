import z from 'zod';
import { TriggersSchema, type Triggers, type TriggerWindow } from './live-note.js';

// ---------------------------------------------------------------------------
// Background tasks
// ---------------------------------------------------------------------------
//
// A bg-task is a persistent agent set up to fire on a schedule and/or in
// response to incoming events. Each task owns a folder under
// `$WorkDir/bg-tasks/<slug>/`:
//
//   bg-tasks/<slug>/
//   ├── task.yaml      # plain YAML: BackgroundTask shape
//   ├── index.md       # agent-owned body — the user-visible artifact
//   └── runs/          # one <runId>.jsonl per run (written by agent runtime)
//
// The agent picks between OUTPUT mode (rewrite index.md with the latest state)
// and ACTION mode (perform a side-effect, append a journal entry) based on
// the verbs in `instructions` each run. No mode field on the task.
// ---------------------------------------------------------------------------

// Re-export triggers so callers don't need a second import.
export { TriggersSchema, type Triggers, type TriggerWindow };

export const BackgroundTaskExecutionTarget = z.enum(['desktop', 'api']);
export type BackgroundTaskExecutionTargetType = z.infer<typeof BackgroundTaskExecutionTarget>;

export const BackgroundTaskRunStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'stopped']);
export type BackgroundTaskRunStatusType = z.infer<typeof BackgroundTaskRunStatus>;

export const BackgroundTaskRunExecutor = z.enum(['desktop', 'api']);
export type BackgroundTaskRunExecutorType = z.infer<typeof BackgroundTaskRunExecutor>;

export const BackgroundTaskSignal = z.enum(['pause', 'resume', 'update_context']);
export type BackgroundTaskSignalType = z.infer<typeof BackgroundTaskSignal>;

export type BackgroundTask = {
    name: string;
    instructions: string;
    active: boolean;
    triggers?: Triggers;
    model?: string;
    provider?: string;
    executionTarget: BackgroundTaskExecutionTargetType;
    createdAt: string;
    // Runtime-managed — never hand-write. Mirrors live-note's flat-field
    // pattern: `lastAttemptAt` is bumped at every run start (backoff anchor),
    // `lastRunAt` / `lastRunSummary` only on successful completion, `lastRunError`
    // only on failure (cleared on next success). This keeps the "last good run"
    // visible even while a new run is in-flight or failing.
    lastAttemptAt?: string;
    lastRunId?: string;
    lastRunAt?: string;
    lastRunSummary?: string;
    lastRunError?: string;
};

export type BackgroundTaskSummary = {
    slug: string;
    name: string;
    instructions: string;
    active: boolean;
    triggers?: Triggers;
    executionTarget: BackgroundTaskExecutionTargetType;
    createdAt: string;
    lastAttemptAt?: string;
    lastRunId?: string;
    lastRunAt?: string;
    lastRunSummary?: string;
    lastRunError?: string;
};

export const BackgroundTaskSchema = z.object({
    name: z.string().min(1).describe('User-facing display name.'),
    instructions: z.string().min(1).describe('A persistent instruction in the user\'s words — what should this task keep doing? E.g. "Summarize my unread emails every morning into a brief digest." The agent re-reads instructions on every run and decides whether to rewrite index.md (OUTPUT mode) or perform a side-effect and journal it (ACTION mode) based on the verbs.'),
    active: z.boolean().default(true).describe('Set false to pause without deleting.'),
    triggers: TriggersSchema.optional().describe('When the agent fires. Omit for manual-only.'),
    model: z.string().optional().describe('ADVANCED — leave unset. Per-task model override.'),
    provider: z.string().optional().describe('ADVANCED — leave unset. Per-task provider name override.'),
    executionTarget: BackgroundTaskExecutionTarget.default('desktop').describe('Where this task executes. desktop runs in the local desktop agent; api runs through the Rowboat API Temporal worker.'),
    createdAt: z.string().describe('ISO timestamp set once at create-time.'),
    lastAttemptAt: z.string().optional().describe('Runtime-managed — never write this yourself. Bumped at the start of every agent run; used by the scheduler for backoff so failures do not retry-storm.'),
    lastRunId: z.string().optional().describe('Runtime-managed — never write this yourself. The id of the most recent run (success or failure); used by the bg-task:stop handler.'),
    lastRunAt: z.string().optional().describe('Runtime-managed — never write this yourself. Bumped only when an agent run *succeeds*; used as the cycle anchor for cron / window triggers and as the freshness timestamp shown in the UI.'),
    lastRunSummary: z.string().optional().describe('Runtime-managed — never write this yourself. Set on success; not overwritten on failure so the user keeps seeing the last good summary.'),
    lastRunError: z.string().optional().describe('Runtime-managed — never write this yourself. Set on a failed run; cleared on the next successful run.'),
});

export const BackgroundTaskSummarySchema = z.object({
    slug: z.string(),
    name: z.string(),
    instructions: z.string(),
    active: z.boolean(),
    triggers: TriggersSchema.optional(),
    executionTarget: BackgroundTaskExecutionTarget.default('desktop'),
    createdAt: z.string(),
    lastAttemptAt: z.string().optional(),
    lastRunId: z.string().optional(),
    lastRunAt: z.string().optional(),
    lastRunSummary: z.string().optional(),
    lastRunError: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Bus events
// ---------------------------------------------------------------------------

export const BackgroundTaskTrigger = z.enum(['manual', 'cron', 'window', 'event']);
export type BackgroundTaskTriggerType = z.infer<typeof BackgroundTaskTrigger>;

const NullableString = z.string().nullable().optional();

export const BackgroundTaskCloudRunSchema = z.object({
    id: z.string().optional(),
    runId: z.string(),
    previousRunId: z.string().optional(),
    // retryOfRunId is set only on retry runs (the run this one re-executes);
    // previousRunId is the plain prior-run pointer. They differ — see the API
    // schema. attempt is the 1-based retry attempt number.
    retryOfRunId: z.string().optional(),
    localRunId: z.string().optional(),
    slug: z.string(),
    trigger: BackgroundTaskTrigger,
    status: BackgroundTaskRunStatus,
    executor: BackgroundTaskRunExecutor,
    attempt: z.number().int().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    useCase: z.string().optional(),
    subUseCase: z.string().optional(),
    requestedContext: z.string().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
    errorDetails: z.string().optional(),
    temporalWorkflowId: z.string().optional(),
    temporalRunId: z.string().optional(),
    temporalStatus: z.string().optional(),
    temporalStartedAt: NullableString,
    temporalClosedAt: NullableString,
    cancelRequestedAt: NullableString,
    progressPercent: z.number().int().min(0).max(100).nullable().optional(),
    progressMessage: z.string().optional(),
    lastHeartbeatAt: NullableString,
    startedAt: NullableString,
    completedAt: NullableString,
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: z.number().int(),
});
export type BackgroundTaskCloudRunType = z.infer<typeof BackgroundTaskCloudRunSchema>;

export const BackgroundTaskCloudRunStatusSchema = z.object({
    runId: z.string(),
    slug: z.string(),
    status: BackgroundTaskRunStatus,
    executor: BackgroundTaskRunExecutor,
    attempt: z.number().int().optional(),
    temporalWorkflowId: z.string().optional(),
    temporalRunId: z.string().optional(),
    temporalStatus: z.string().optional(),
    progressPercent: z.number().int().min(0).max(100).nullable().optional(),
    progressMessage: z.string().optional(),
    lastHeartbeatAt: NullableString,
    startedAt: NullableString,
    completedAt: NullableString,
    cancelRequestedAt: NullableString,
    error: z.string().optional(),
    errorCode: z.string().optional(),
    errorDetails: z.string().optional(),
    revision: z.number().int(),
});
export type BackgroundTaskCloudRunStatusType = z.infer<typeof BackgroundTaskCloudRunStatusSchema>;

// Artifact sync state describes how the locally-pulled bg-tasks/<slug>/index.md
// relates to the latest remote artifact. `syncing` is a renderer-transient state
// (set while a pull IPC is in flight); the core returns the other four.
export const BackgroundTaskArtifactSyncState = z.enum([
    'current',
    'remote_newer',
    'syncing',
    'pull_failed',
    'not_pulled',
]);
export type BackgroundTaskArtifactSyncStateType = z.infer<typeof BackgroundTaskArtifactSyncState>;

export const BackgroundTaskArtifactSyncSchema = z.object({
    state: BackgroundTaskArtifactSyncState,
    localRevision: z.number().int().nullable(),
    remoteRevision: z.number().int(),
    updatedByRunId: z.string().optional(),
    updatedAt: z.string().optional(),
    contentType: z.string().optional(),
    error: z.string().optional(),
});
export type BackgroundTaskArtifactSyncType = z.infer<typeof BackgroundTaskArtifactSyncSchema>;

export const BackgroundTaskCloudRunEventSchema = z.object({
    id: z.string(),
    seq: z.number().int().nonnegative(),
    type: z.string().optional(),
    event: z.unknown(),
    receivedAt: z.string(),
});
export type BackgroundTaskCloudRunEventType = z.infer<typeof BackgroundTaskCloudRunEventSchema>;

export const BackgroundTaskAgentStartEvent = z.object({
    type: z.literal('background_task_agent_start'),
    slug: z.string(),
    trigger: BackgroundTaskTrigger,
    runId: z.string(),
});

export const BackgroundTaskAgentCompleteEvent = z.object({
    type: z.literal('background_task_agent_complete'),
    slug: z.string(),
    runId: z.string(),
    error: z.string().optional(),
    summary: z.string().optional(),
});

export const BackgroundTaskAgentEvent = z.union([BackgroundTaskAgentStartEvent, BackgroundTaskAgentCompleteEvent]);
export type BackgroundTaskAgentEventType = z.infer<typeof BackgroundTaskAgentEvent>;
