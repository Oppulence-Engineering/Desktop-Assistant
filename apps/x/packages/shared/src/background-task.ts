import z from "zod";
import { TriggersSchema, type Triggers, type TriggerWindow } from "./live-note.js";

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

export const BackgroundTaskExecutionTarget = z.enum(["desktop", "api"]);
export type BackgroundTaskExecutionTargetType = z.infer<typeof BackgroundTaskExecutionTarget>;

export const BackgroundTaskRunStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "stopped",
]);
export type BackgroundTaskRunStatusType = z.infer<typeof BackgroundTaskRunStatus>;

export const BackgroundTaskRunExecutor = z.enum(["desktop", "api"]);
export type BackgroundTaskRunExecutorType = z.infer<typeof BackgroundTaskRunExecutor>;

export const BackgroundTaskSignal = z.enum([
  "pause",
  "resume",
  "update_context",
  "approve_tool",
  "deny_tool",
]);
export type BackgroundTaskSignalType = z.infer<typeof BackgroundTaskSignal>;

// Temporal Schedule sync health for the cron sub-trigger of api-target tasks
// (RFC 005). Server-owned — set only by the API's schedule syncer/reconciler;
// the desktop renders it and never writes it. `current` means Temporal owns
// the cron firing; any other state means the API scheduler loop is the
// fallback. Older APIs omit these fields entirely.
export const BackgroundTaskScheduleSyncState = z.enum(["current", "syncing", "failed", "paused"]);
export type BackgroundTaskScheduleSyncStateType = z.infer<typeof BackgroundTaskScheduleSyncState>;

// ---------------------------------------------------------------------------
// Cloud schedule state (RFC 006)
// ---------------------------------------------------------------------------
//
// The normalized schedule summary served by
// GET /v1/background-tasks/{slug}/schedule-state and surfaced via the
// bg-task:getCloudScheduleState IPC channel: which mechanism owns each trigger
// source, its health, and the next expected fire. Read-only, on-demand cadence
// (the task list uses the persisted scheduleSyncState instead).

export const BackgroundTaskScheduleHealth = z.enum([
  "current",
  "syncing",
  "failed",
  "paused",
  "unknown",
]);
export type BackgroundTaskScheduleHealthType = z.infer<typeof BackgroundTaskScheduleHealth>;

export const BackgroundTaskScheduleMechanism = z.enum([
  "desktop_loop",
  "rowboat_loop",
  "temporal_schedule",
  "none",
]);
export type BackgroundTaskScheduleMechanismType = z.infer<typeof BackgroundTaskScheduleMechanism>;

export const BackgroundTaskScheduleSource = z.enum(["cron", "window", "event"]);
export type BackgroundTaskScheduleSourceType = z.infer<typeof BackgroundTaskScheduleSource>;

const ScheduleSourceStateSchema = z.object({
  mechanism: BackgroundTaskScheduleMechanism,
  health: BackgroundTaskScheduleHealth,
  nextDueAt: z.string().nullable().optional(),
  lastEvaluatedAt: z.string().nullable().optional(),
  lastTriggeredAt: z.string().nullable().optional(),
});

export const BackgroundTaskCloudScheduleStateSchema = z.object({
  target: BackgroundTaskExecutionTarget,
  triggerSources: z.array(BackgroundTaskScheduleSource),
  health: BackgroundTaskScheduleHealth,
  mechanism: BackgroundTaskScheduleMechanism,
  nextDueAt: z.string().nullable().optional(),
  lastEvaluatedAt: z.string().nullable().optional(),
  lastTriggeredAt: z.string().nullable().optional(),
  scheduleSyncState: BackgroundTaskScheduleSyncState.optional(),
  // Per-source detail for mixed cron+window tasks; optional so a compact
  // aggregate can render without it.
  sources: z.partialRecord(BackgroundTaskScheduleSource, ScheduleSourceStateSchema).optional(),
});
export type BackgroundTaskCloudScheduleStateType = z.infer<
  typeof BackgroundTaskCloudScheduleStateSchema
>;

// Offline-return notification payload (RFC 006): pushed from main to the
// renderer after boot when cloud runs completed while the app was closed.
export const BackgroundTaskOfflineRunsEventSchema = z.object({
  count: z.number().int().nonnegative(),
  runs: z.array(
    z.object({
      slug: z.string(),
      runId: z.string(),
      status: BackgroundTaskRunStatus,
      trigger: z.string(),
      completedAt: z.string().nullable().optional(),
      summary: z.string().optional(),
    }),
  ),
});
export type BackgroundTaskOfflineRunsEventType = z.infer<
  typeof BackgroundTaskOfflineRunsEventSchema
>;

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
  // Server-owned schedule sync health (RFC 005); absent from older APIs.
  scheduleSyncState?: BackgroundTaskScheduleSyncStateType;
  scheduleSyncError?: string;
  scheduleSyncedAt?: string;
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
  scheduleSyncState?: BackgroundTaskScheduleSyncStateType;
  scheduleSyncError?: string;
  scheduleSyncedAt?: string;
};

export const BackgroundTaskSchema = z.object({
  name: z.string().min(1).describe("User-facing display name."),
  instructions: z
    .string()
    .min(1)
    .describe(
      'A persistent instruction in the user\'s words — what should this task keep doing? E.g. "Summarize my unread emails every morning into a brief digest." The agent re-reads instructions on every run and decides whether to rewrite index.md (OUTPUT mode) or perform a side-effect and journal it (ACTION mode) based on the verbs.',
    ),
  active: z.boolean().default(true).describe("Set false to pause without deleting."),
  triggers: TriggersSchema.optional().describe("When the agent fires. Omit for manual-only."),
  model: z.string().optional().describe("ADVANCED — leave unset. Per-task model override."),
  provider: z
    .string()
    .optional()
    .describe("ADVANCED — leave unset. Per-task provider name override."),
  executionTarget: BackgroundTaskExecutionTarget.default("desktop").describe(
    "Where this task executes. desktop runs in the local desktop agent; api runs through the Solomon AI API Temporal worker.",
  ),
  createdAt: z.string().describe("ISO timestamp set once at create-time."),
  lastAttemptAt: z
    .string()
    .optional()
    .describe(
      "Runtime-managed — never write this yourself. Bumped at the start of every agent run; used by the scheduler for backoff so failures do not retry-storm.",
    ),
  lastRunId: z
    .string()
    .optional()
    .describe(
      "Runtime-managed — never write this yourself. The id of the most recent run (success or failure); used by the bg-task:stop handler.",
    ),
  lastRunAt: z
    .string()
    .optional()
    .describe(
      "Runtime-managed — never write this yourself. Bumped only when an agent run *succeeds*; used as the cycle anchor for cron / window triggers and as the freshness timestamp shown in the UI.",
    ),
  lastRunSummary: z
    .string()
    .optional()
    .describe(
      "Runtime-managed — never write this yourself. Set on success; not overwritten on failure so the user keeps seeing the last good summary.",
    ),
  lastRunError: z
    .string()
    .optional()
    .describe(
      "Runtime-managed — never write this yourself. Set on a failed run; cleared on the next successful run.",
    ),
  scheduleSyncState: BackgroundTaskScheduleSyncState.optional().describe(
    "Server-owned — never write this yourself. Temporal Schedule sync health for the cron sub-trigger (RFC 005): current means Temporal owns the cron; syncing/failed/paused mean the API loop is the fallback.",
  ),
  scheduleSyncError: z
    .string()
    .optional()
    .describe(
      "Server-owned — never write this yourself. Last schedule sync failure, set while scheduleSyncState=failed.",
    ),
  scheduleSyncedAt: z
    .string()
    .optional()
    .describe(
      "Server-owned — never write this yourself. When the Temporal Schedule last converged successfully.",
    ),
});

export const BackgroundTaskPatchSchema = BackgroundTaskSchema.omit({
  executionTarget: true,
})
  .partial()
  .extend({
    executionTarget: BackgroundTaskExecutionTarget.optional(),
  });

export const BackgroundTaskSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  instructions: z.string(),
  active: z.boolean(),
  triggers: TriggersSchema.optional(),
  executionTarget: BackgroundTaskExecutionTarget.default("desktop"),
  createdAt: z.string(),
  lastAttemptAt: z.string().optional(),
  lastRunId: z.string().optional(),
  lastRunAt: z.string().optional(),
  lastRunSummary: z.string().optional(),
  lastRunError: z.string().optional(),
  scheduleSyncState: BackgroundTaskScheduleSyncState.optional(),
  scheduleSyncError: z.string().optional(),
  scheduleSyncedAt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Bus events
// ---------------------------------------------------------------------------

// `retry` is emitted by the API for retry runs (distinct from the original
// trigger); the desktop must accept it so cloud-run parsing + the trigger filter
// don't reject it.
export const BackgroundTaskTrigger = z.enum(["manual", "cron", "window", "event", "retry"]);
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
  // Originating cloud event (RFC 003 linkage) — present only on the
  // single-run GET; list/status responses stay slim.
  sourceEvent: z
    .object({
      id: z.string(),
      source: z.string(),
      eventType: z.string().optional(),
      subject: z.string().optional(),
      occurredAt: NullableString,
    })
    .optional(),
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
  "current",
  "remote_newer",
  "syncing",
  "pull_failed",
  "not_pulled",
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

/**
 * Canonical cloud run event types, mirroring the api's backgroundtaskworkflow
 * vocabulary (events.go is the source of truth; keep in sync). `type` above
 * deliberately stays a free string so unknown/newer types flow through.
 * runtime.* entries are the RFC 004 agent-runtime transcript events.
 */
export const CLOUD_RUN_EVENT_TYPES = [
  "temporal.queued",
  "temporal.running",
  "temporal.progress",
  "temporal.artifact_updated",
  "temporal.completed",
  "temporal.failed",
  "temporal.cancel_requested",
  "temporal.stopped",
  "temporal.signal",
  "temporal.retry_requested",
  "runtime.llm_call_started",
  "runtime.llm_call_completed",
  "runtime.tool_call_started",
  "runtime.tool_call_completed",
  "runtime.tool_approval_requested",
  "runtime.tool_approval_resolved",
  "runtime.tool_denied",
  "runtime.limit_exceeded",
  "runtime.final_artifact_ready",
  "desktop.run_processing_start",
  "desktop.run_processing_end",
  "desktop.start",
  "desktop.spawn_subflow",
  "desktop.llm_stream_event",
  "desktop.message",
  "desktop.tool_invocation",
  "desktop.tool_result",
  "desktop.tool_output_stream",
  "desktop.ask_human_request",
  "desktop.ask_human_response",
  "desktop.tool_permission_request",
  "desktop.tool_permission_response",
  "desktop.code_run_event",
  "desktop.code_run_permission_request",
  "desktop.tool_permission_auto_decision",
  "desktop.error",
  "desktop.run_stopped",
] as const;

/**
 * Cloud run error codes surfaced raw in `errorCode`, mirroring errcodes.go.
 * The runtime_* family plus llm/tool/connector codes are RFC 004's
 * non-retryable runtime failures.
 */
export const CLOUD_RUN_ERROR_CODES = [
  "temporal_unavailable",
  "temporal_start_failed",
  "temporal_cancel_failed",
  "temporal_signal_failed",
  "workflow_canceled",
  "activity_timeout",
  "activity_failed",
  "task_not_found",
  "task_invalid",
  "artifact_write_failed",
  "db_error",
  "internal",
  "runtime_deadline_exceeded",
  "runtime_llm_budget_exceeded",
  "runtime_tool_budget_exceeded",
  "runtime_artifact_too_large",
  "runtime_event_too_large",
  "llm_call_failed",
  "tool_not_allowed",
  "tool_invoke_failed",
  "connector_unavailable",
] as const;

export const BackgroundTaskAgentStartEvent = z.object({
  type: z.literal("background_task_agent_start"),
  slug: z.string(),
  trigger: BackgroundTaskTrigger,
  runId: z.string(),
});

export const BackgroundTaskAgentCompleteEvent = z.object({
  type: z.literal("background_task_agent_complete"),
  slug: z.string(),
  runId: z.string(),
  error: z.string().optional(),
  summary: z.string().optional(),
});

export const BackgroundTaskAgentEvent = z.union([
  BackgroundTaskAgentStartEvent,
  BackgroundTaskAgentCompleteEvent,
]);
export type BackgroundTaskAgentEventType = z.infer<typeof BackgroundTaskAgentEvent>;
