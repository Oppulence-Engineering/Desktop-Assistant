import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import {
  ListChecks,
  Play,
  Square,
  Loader2,
  Trash2,
  Plus,
  X,
  AlertCircle,
  Repeat,
  Clock,
  Zap,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Cloud,
  Laptop,
  RotateCcw,
  Pause,
  Download,
  CheckCircle2,
  Terminal,
  Server,
  Workflow,
  InfoIcon,
} from "@/lib/icons";
import type { z } from "zod";
import type {
  BackgroundTask,
  BackgroundTaskArtifactSyncStateType,
  BackgroundTaskArtifactSyncType,
  BackgroundTaskCloudRunEventType,
  BackgroundTaskCloudRunStatusType,
  BackgroundTaskCloudRunType,
  BackgroundTaskCloudScheduleStateType,
  BackgroundTaskExecutionTargetType,
  BackgroundTaskRunStatusType,
  BackgroundTaskTriggerType,
  BackgroundTaskSummary,
  Triggers,
} from "@x/shared/dist/background-task.js";
import type { Run } from "@x/shared/dist/runs.js";
import { Button } from "@oppulence/ui/components/button";
import { Switch } from "@oppulence/ui/components/switch";
import { Input } from "@oppulence/ui/components/input";
import { Textarea } from "@oppulence/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { useBackgroundTaskAgentStatus } from "@/hooks/use-bg-task-agent-status";
import { formatRelativeTime } from "@/lib/relative-time";
import { toast } from "@/lib/toast";
import type { ConversationItem } from "@/lib/chat-conversation";
import { runLogToConversation } from "@/lib/run-to-conversation";
import { CompactConversation } from "@/components/compact-conversation";
import { RichMarkdownViewer } from "@/components/rich-markdown-viewer";

// ---------------------------------------------------------------------------
// Trigger helpers (inlined; extract to shared <TriggersEditor> as a follow-up)
// ---------------------------------------------------------------------------

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const CRON_PHRASES: Record<string, string> = {
  "* * * * *": "Every minute",
  "*/5 * * * *": "Every 5 minutes",
  "*/15 * * * *": "Every 15 minutes",
  "*/30 * * * *": "Every 30 minutes",
  "0 * * * *": "Hourly, on the hour",
  "0 */2 * * *": "Every 2 hours",
  "0 */6 * * *": "Every 6 hours",
  "0 */12 * * *": "Every 12 hours",
  "0 0 * * *": "Daily at midnight",
  "0 8 * * *": "Daily at 8 AM",
  "0 9 * * *": "Daily at 9 AM",
  "0 12 * * *": "Daily at noon",
  "0 18 * * *": "Daily at 6 PM",
  "0 9 * * 1-5": "Weekdays at 9 AM",
  "0 17 * * 1-5": "Weekdays at 5 PM",
};

function describeCron(expr: string): string {
  return CRON_PHRASES[expr.trim()] ?? expr;
}

function summarizeSchedule(triggers: Triggers | undefined): string {
  if (!triggers) return "Manual only";
  const parts: string[] = [];
  if (triggers.cronExpr) parts.push(describeCron(triggers.cronExpr));
  if (triggers.windows && triggers.windows.length > 0) {
    parts.push(
      triggers.windows.length === 1
        ? `${triggers.windows[0].startTime}–${triggers.windows[0].endTime}`
        : `${triggers.windows.length} windows`,
    );
  }
  if (triggers.eventMatchCriteria) parts.push("events");
  return parts.length === 0 ? "Manual only" : parts.join(" · ");
}

function formatRunAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} · ${time}`;
}

// `formatRelativeTime` returns "just now" for sub-minute, otherwise compact
// units like "5 m" / "3 h" / "2 d". Naively appending " ago" reads wrong for
// "just now"; this helper handles both shapes.
function relativeLabel(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const rel = formatRelativeTime(iso);
  if (!rel) return null;
  if (rel === "just now") return rel;
  return `${rel} ago`;
}

type ExecutionTarget = BackgroundTaskExecutionTargetType;

// ---------------------------------------------------------------------------
// Cloud schedule state (RFC 006)
// ---------------------------------------------------------------------------

// scheduleOwnershipLabel makes cloud-managed vs desktop-managed explicit on
// every task row — the core RFC 006 distinction.
function scheduleOwnershipLabel(target: ExecutionTarget, triggers: Triggers | undefined): string {
  const timed = !!(triggers?.cronExpr || (triggers?.windows?.length ?? 0) > 0);
  const evented = !!triggers?.eventMatchCriteria;
  if (target === "api") {
    return timed || evented ? "Cloud scheduled" : "Cloud manual";
  }
  return timed || evented ? "Runs when desktop is open" : "Manual only";
}

// triggeredByLabel renders the run's provenance (RFC 006 event→run line):
// the originating cloud event when linked, otherwise the plain trigger.
function triggeredByLabel(run: BackgroundTaskCloudRunType): string {
  if (run.sourceEvent) {
    const what = run.sourceEvent.eventType ?? run.sourceEvent.source;
    return run.sourceEvent.subject ? `${what} — ${run.sourceEvent.subject}` : what;
  }
  switch (run.trigger) {
    case "cron":
      return "cron schedule";
    case "window":
      return "time window";
    case "event":
      return "cloud event";
    case "retry":
      return run.retryOfRunId ? `retry of ${run.retryOfRunId}` : "retry of an earlier run";
    default:
      return "manual trigger";
  }
}

const SCHEDULE_HEALTH_META: Record<string, { label: string; dot: string; tone: string }> = {
  current: {
    label: "current",
    dot: "bg-emerald-500",
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  syncing: { label: "syncing", dot: "bg-sky-500", tone: "text-sky-700 dark:text-sky-400" },
  failed: { label: "didn't sync", dot: "bg-red-500", tone: "text-red-700 dark:text-red-400" },
  paused: { label: "paused", dot: "bg-muted-foreground/60", tone: "text-muted-foreground" },
  unknown: { label: "unknown", dot: "bg-amber-500", tone: "text-amber-700 dark:text-amber-400" },
};

// formatNextRun renders a future fire time compactly ("Today 14:00").
function formatNextRun(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${hm}`;
  if (isTomorrow) return `Tomorrow ${hm}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm}`;
}

// useCloudScheduleState fetches the normalized schedule summary for an
// api-target task at a slow on-demand cadence (60s) — never coupled to the
// 2-3s run polling.
function useCloudScheduleState(slug: string | null, target: ExecutionTarget, hasTriggers: boolean) {
  const [state, setState] = useState<BackgroundTaskCloudScheduleStateType | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!slug || target !== "api" || !hasTriggers) {
      setState(null);
      setScheduleError(null);
      return;
    }
    const taskSlug = slug;
    let cancelled = false;
    async function load() {
      try {
        const result = await window.ipc.invoke("bg-task:getCloudScheduleState", {
          slug: taskSlug,
        });
        if (cancelled) return;
        if (result.success) {
          setState(result.state ?? null);
          setScheduleError(null);
        } else {
          setScheduleError(result.error ?? "Could not load schedule state.");
        }
      } catch (err) {
        if (!cancelled) {
          setScheduleError(err instanceof Error ? err.message : "Could not load schedule state.");
        }
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [slug, target, hasTriggers, reloadKey]);

  return {
    scheduleState: state,
    scheduleError,
    reloadScheduleState: () => setReloadKey((k) => k + 1),
  };
}

// CloudScheduleStatus is the compact per-task schedule chip (RFC 006 §1):
// ownership, next fire, and health — operational context, never blocking.
function CloudScheduleStatus({
  state,
  error,
  onRetry,
}: {
  state: BackgroundTaskCloudScheduleStateType | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-none border border-sidebar-border bg-background/60 px-2.5 py-2 text-xs">
        <AlertCircle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 truncate text-muted-foreground" title={error}>
          Can't load cloud schedule state.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Retry"
          title="Retry"
        >
          <RotateCcw className="size-3" />
        </button>
      </div>
    );
  }
  if (!state) return null;
  const health = SCHEDULE_HEALTH_META[state.health] ?? SCHEDULE_HEALTH_META.unknown;
  const mechanismLabel =
    state.mechanism === "temporal_schedule"
      ? "Temporal cron"
      : state.mechanism === "rowboat_loop"
        ? "Cloud loop"
        : null;
  return (
    <div className="mt-3 rounded-none border border-sidebar-border bg-background/60 px-2.5 py-2">
      <div className="flex items-center gap-2 text-xs">
        <Cloud className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">Cloud scheduled</span>
        {mechanismLabel && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {mechanismLabel}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${health.dot}`} aria-hidden />
          <span className={health.tone}>{health.label}</span>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          {state.nextDueAt ? `Next run: ${formatNextRun(state.nextDueAt)}` : "No upcoming run"}
        </span>
        {state.lastEvaluatedAt && (
          <span>Last eval: {relativeLabel(state.lastEvaluatedAt) ?? "recently"}</span>
        )}
      </div>
    </div>
  );
}

const TERMINAL_CLOUD_STATUSES = new Set<BackgroundTaskRunStatusType>([
  "succeeded",
  "failed",
  "stopped",
]);

function executionTargetOf(
  task: Pick<BackgroundTask, "executionTarget"> | Pick<BackgroundTaskSummary, "executionTarget">,
): ExecutionTarget {
  return task.executionTarget ?? "desktop";
}

function isTerminalCloudStatus(status: BackgroundTaskRunStatusType | undefined): boolean {
  return status ? TERMINAL_CLOUD_STATUSES.has(status) : false;
}

function cloudStatusTone(status: BackgroundTaskRunStatusType | undefined): string {
  if (status === "failed") return "text-destructive";
  if (status === "stopped") return "text-muted-foreground";
  if (status === "succeeded") return "text-emerald-600 dark:text-emerald-400";
  return "text-amber-600 dark:text-amber-400";
}

function cloudStatusDot(status: BackgroundTaskRunStatusType | undefined): string {
  if (status === "failed") return "bg-destructive";
  if (status === "stopped") return "bg-muted-foreground";
  if (status === "succeeded") return "bg-emerald-500";
  return "bg-amber-500 animate-pulse";
}

// Maps an artifact sync state to its UI presentation. `canPull` controls whether
// the "Pull" affordance is offered (any state where the local copy is stale or
// the last pull failed).
function artifactSyncPresentation(state: BackgroundTaskArtifactSyncStateType): {
  label: string;
  tone: string;
  dot: string;
  canPull: boolean;
} {
  switch (state) {
    case "current":
      return {
        label: "Artifact in sync",
        tone: "text-emerald-600 dark:text-emerald-400",
        dot: "bg-emerald-500",
        canPull: false,
      };
    case "remote_newer":
      return {
        label: "Remote newer",
        tone: "text-amber-600 dark:text-amber-400",
        dot: "bg-amber-500",
        canPull: true,
      };
    case "syncing":
      return {
        label: "Syncing…",
        tone: "text-muted-foreground",
        dot: "bg-muted-foreground animate-pulse",
        canPull: false,
      };
    case "pull_failed":
      return {
        label: "Pull failed",
        tone: "text-destructive",
        dot: "bg-destructive",
        canPull: true,
      };
    case "not_pulled":
      return {
        label: "Not pulled",
        tone: "text-amber-600 dark:text-amber-400",
        dot: "bg-amber-500",
        canPull: true,
      };
  }
}

function cloudRunStatusFromRun(run: BackgroundTaskCloudRunType): BackgroundTaskCloudRunStatusType {
  return {
    runId: run.runId,
    slug: run.slug,
    status: run.status,
    executor: run.executor,
    temporalWorkflowId: run.temporalWorkflowId,
    temporalRunId: run.temporalRunId,
    temporalStatus: run.temporalStatus,
    progressPercent: run.progressPercent,
    progressMessage: run.progressMessage,
    lastHeartbeatAt: run.lastHeartbeatAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
    revision: run.revision,
  };
}

function eventBodyText(event: BackgroundTaskCloudRunEventType["event"]): string {
  if (typeof event === "string") return event;
  try {
    return JSON.stringify(event, null, 2);
  } catch {
    return String(event);
  }
}

type EventPayload = Record<string, unknown>;

function isEventPayload(value: unknown): value is EventPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventPayload(event: BackgroundTaskCloudRunEventType["event"]): EventPayload {
  return isEventPayload(event) ? event : {};
}

function payloadString(payload: EventPayload, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function payloadNumber(payload: EventPayload, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadBool(payload: EventPayload, key: string): boolean {
  return payload[key] === true;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMs(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 60 * 60_000) return `${(ms / 60_000).toFixed(1)} min`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)} h`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)} d`;
}

function durationAcrossEvents(events: BackgroundTaskCloudRunEventType[]): string | null {
  const times = events
    .map((event) => new Date(event.receivedAt).getTime())
    .filter((time) => Number.isFinite(time));
  if (times.length < 2) return null;
  return formatMs(Math.max(...times) - Math.min(...times));
}

function firstEventTimestamp(events: BackgroundTaskCloudRunEventType[]): string | null {
  const times = events
    .map((event) => new Date(event.receivedAt).getTime())
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;
  return new Date(Math.min(...times)).toISOString();
}

function cloudEventTitle(type: string | undefined, payload: EventPayload): string {
  const eventType = type ?? payloadString(payload, "type") ?? "event";
  switch (eventType) {
    case "runtime.tool_call_started":
      return `Tool started${payloadString(payload, "tool") ? ` · ${payloadString(payload, "tool")}` : ""}`;
    case "runtime.tool_call_completed":
      return `Tool completed${payloadString(payload, "tool") ? ` · ${payloadString(payload, "tool")}` : ""}`;
    case "runtime.tool_denied":
      return "Tool denied";
    case "runtime.tool_approval_requested":
      return "Tool approval requested";
    case "runtime.tool_approval_resolved":
      return "Tool approval resolved";
    case "runtime.llm_call_started":
      return "LLM call started";
    case "runtime.llm_call_completed":
      return "LLM call completed";
    case "runtime.limit_exceeded":
      return "Runtime limit exceeded";
    case "runtime.final_artifact_ready":
      return "Final artifact ready";
    case "run_started":
      return "Run started";
    case "artifact_updated":
      return "Artifact updated";
    case "run_completed":
      return "Run completed";
    case "run_failed":
      return "Run failed";
    case "temporal.progress":
      return "Progress";
    case "temporal.artifact_updated":
      return "Artifact updated";
    case "temporal.completed":
      return "Run completed";
    case "temporal.failed":
      return "Run failed";
    case "temporal.running":
      return "Run started";
    case "temporal.queued":
      return "Run queued";
    default:
      return eventType;
  }
}

function durationBetween(startIso: string | null | undefined, endIso: string | null | undefined) {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return formatMs(Math.round(end - start));
}

function formatTraceOffset(firstIso: string | null | undefined, currentIso: string): string | null {
  if (!firstIso) return null;
  const first = new Date(firstIso).getTime();
  const current = new Date(currentIso).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(current) || current < first) return null;
  return `T+${formatMs(Math.round(current - first))}`;
}

function compactPayloadText(value: string | null, max = 220): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}

function cloudEventStageLabel(type: string | undefined, payload: EventPayload): string {
  const eventType = type ?? payloadString(payload, "type") ?? "";
  if (payloadString(payload, "tool") === sandboxToolNameForUI) return "Sandbox";
  if (eventType.startsWith("runtime.tool")) return "Tool";
  if (eventType.startsWith("runtime.llm")) return "LLM";
  if (eventType.startsWith("temporal.") || eventType.startsWith("run_")) return "Workflow";
  if (eventType.startsWith("desktop.")) return "Desktop";
  if (eventType.includes("artifact")) return "Artifact";
  return "Event";
}

function cloudEventOutcome(
  type: string | undefined,
  payload: EventPayload,
): {
  label: string;
  className: string;
  nodeClassName: string;
} {
  const eventType = type ?? payloadString(payload, "type") ?? "";
  if (
    eventType.includes("failed") ||
    eventType.includes("error") ||
    payloadString(payload, "error")
  ) {
    return {
      label: "error",
      className: "border-destructive/30 bg-destructive/10 text-destructive",
      nodeClassName: "border-destructive/40 bg-destructive/10",
    };
  }
  if (
    eventType.includes("completed") ||
    eventType.includes("artifact_updated") ||
    payloadString(payload, "status") === "succeeded"
  ) {
    return {
      label: "ok",
      className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      nodeClassName: "border-emerald-500/35 bg-emerald-500/10",
    };
  }
  if (
    eventType.includes("started") ||
    eventType.includes("running") ||
    eventType.includes("queued")
  ) {
    return {
      label: "active",
      className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
      nodeClassName: "border-sky-500/35 bg-sky-500/10",
    };
  }
  return {
    label: "event",
    className: "border-border bg-muted/40 text-muted-foreground",
    nodeClassName: "border-border bg-background",
  };
}

function cloudEventSummary(
  type: string | undefined,
  payload: EventPayload,
  event: BackgroundTaskCloudRunEventType["event"],
): string | null {
  const eventType = type ?? payloadString(payload, "type") ?? "";
  const direct =
    payloadString(payload, "error") ??
    payloadString(payload, "message") ??
    payloadString(payload, "summary") ??
    payloadString(payload, "reason");
  if (direct) return compactPayloadText(direct);

  if (eventType.startsWith("runtime.llm")) {
    const model = payloadString(payload, "model");
    const latency = formatMs(payloadNumber(payload, "latencyMs"));
    const input = payloadString(payload, "inputTokens");
    const output = payloadString(payload, "outputTokens");
    return [model, latency, input && output ? `${input} in / ${output} out` : null]
      .filter(Boolean)
      .join(" · ");
  }

  if (eventType.startsWith("runtime.tool")) {
    const tool = payloadString(payload, "tool");
    const operation = payloadString(payload, "operation");
    const latency = formatMs(payloadNumber(payload, "latencyMs"));
    return [tool, operation, latency].filter(Boolean).join(" · ");
  }

  const sandboxOutput = compactPayloadText(payloadString(payload, "sandboxOutput"));
  if (sandboxOutput) return sandboxOutput;

  if (typeof event === "string") return compactPayloadText(event);
  return null;
}

function cloudEventTone(type: string | undefined, payload: EventPayload): string {
  const eventType = type ?? payloadString(payload, "type") ?? "";
  if (
    eventType.includes("failed") ||
    eventType.includes("error") ||
    payloadString(payload, "error")
  ) {
    return "text-destructive";
  }
  if (
    eventType === "runtime.tool_call_completed" &&
    payloadString(payload, "tool") === sandboxToolNameForUI
  ) {
    const status = payloadString(payload, "sandboxStatus");
    if (status === "failed" || status === "timeout" || payloadBool(payload, "sandboxTimedOut")) {
      return "text-destructive";
    }
    if (status === "succeeded") return "text-emerald-700 dark:text-emerald-400";
  }
  if (eventType.includes("completed") || eventType.includes("artifact_updated")) {
    return "text-emerald-700 dark:text-emerald-400";
  }
  return "text-muted-foreground";
}

function CloudEventIcon({ type, payload }: { type: string | undefined; payload: EventPayload }) {
  const eventType = type ?? payloadString(payload, "type") ?? "";
  const className = `size-3.5 shrink-0 ${cloudEventTone(type, payload)}`;
  if (payloadString(payload, "tool") === sandboxToolNameForUI)
    return <Server className={className} />;
  if (eventType.startsWith("runtime.tool")) return <Terminal className={className} />;
  if (eventType.startsWith("runtime.llm")) return <Sparkles className={className} />;
  if (eventType.startsWith("temporal.")) return <Workflow className={className} />;
  if (eventType.startsWith("desktop.")) return <Laptop className={className} />;
  if (cloudEventTone(type, payload) === "text-destructive")
    return <AlertCircle className={className} />;
  return <InfoIcon className={className} />;
}

const sandboxToolNameForUI = "sandbox.run";

type EventField = { label: string; value: ReactNode; title?: string };

function EventFields({ fields }: { fields: EventField[] }) {
  const visible = fields.filter(
    (field) => field.value !== null && field.value !== undefined && field.value !== "",
  );
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
      {visible.map((field) => (
        <div key={field.label} className="contents">
          <div className="text-muted-foreground">{field.label}</div>
          <div className="min-w-0 truncate font-mono text-foreground/80" title={field.title}>
            {field.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function RuntimeEventDetails({ payload }: { payload: EventPayload }) {
  const isSandbox = payloadString(payload, "tool") === sandboxToolNameForUI;
  const sandboxOutput = payloadString(payload, "sandboxOutput");
  const sandboxStatus = payloadString(payload, "sandboxStatus");
  return (
    <div className="space-y-2">
      <EventFields
        fields={[
          { label: "Tool", value: payloadString(payload, "tool") },
          { label: "Call", value: payloadString(payload, "callIndex") },
          { label: "Trust", value: payloadString(payload, "trustTier") },
          { label: "Connector", value: payloadString(payload, "connector") },
          { label: "Operation", value: payloadString(payload, "operation") },
          {
            label: "Approval",
            value: payloadString(payload, "approvalId"),
            title: payloadString(payload, "approvalId") ?? undefined,
          },
          { label: "Latency", value: formatMs(payloadNumber(payload, "latencyMs")) },
          { label: "Result", value: formatBytes(payloadNumber(payload, "resultBytes")) },
          {
            label: "Error",
            value: payloadString(payload, "error"),
            title: payloadString(payload, "error") ?? undefined,
          },
        ]}
      />
      {isSandbox && (
        <div className="space-y-2 border-t border-border/70 pt-2">
          <EventFields
            fields={[
              { label: "Backend", value: payloadString(payload, "sandboxBackend") },
              { label: "Sandbox", value: sandboxStatus },
              {
                label: "Workload",
                value: payloadString(payload, "sandboxJobName"),
                title: payloadString(payload, "sandboxJobName") ?? undefined,
              },
              { label: "Exit", value: payloadString(payload, "sandboxExitCode") },
              { label: "Output", value: formatBytes(payloadNumber(payload, "sandboxOutputBytes")) },
              { label: "Timed out", value: payloadBool(payload, "sandboxTimedOut") ? "yes" : null },
              {
                label: "Truncated",
                value: payloadBool(payload, "sandboxOutputTruncated") ? "yes" : null,
              },
              {
                label: "Preview",
                value: payloadBool(payload, "sandboxOutputEventTruncated") ? "truncated" : null,
              },
            ]}
          />
          {sandboxOutput && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Output
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3 font-mono text-[11px] leading-relaxed text-foreground/80">
                {sandboxOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LLMEventDetails({ payload }: { payload: EventPayload }) {
  return (
    <EventFields
      fields={[
        { label: "Model", value: payloadString(payload, "model") },
        { label: "Provider", value: payloadString(payload, "provider") },
        { label: "Call", value: payloadString(payload, "callIndex") },
        { label: "Latency", value: formatMs(payloadNumber(payload, "latencyMs")) },
        { label: "Input", value: payloadString(payload, "inputTokens") },
        { label: "Output", value: payloadString(payload, "outputTokens") },
        { label: "Prompt", value: payloadString(payload, "prompt_version") },
      ]}
    />
  );
}

function TemporalEventDetails({ payload }: { payload: EventPayload }) {
  return (
    <EventFields
      fields={[
        { label: "Percent", value: payloadString(payload, "percent") },
        {
          label: "Message",
          value: payloadString(payload, "message"),
          title: payloadString(payload, "message") ?? undefined,
        },
        { label: "Limit", value: payloadString(payload, "limit") },
        { label: "Value", value: payloadString(payload, "value") },
        { label: "Max", value: payloadString(payload, "max") },
        { label: "Bytes", value: formatBytes(payloadNumber(payload, "artifactBytes")) },
        { label: "Type", value: payloadString(payload, "contentType") },
      ]}
    />
  );
}

function RawEventDetails({ event }: { event: BackgroundTaskCloudRunEventType["event"] }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-[10.5px] text-muted-foreground hover:text-foreground">
        Raw event
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3 font-mono text-[11px] leading-relaxed text-foreground/70">
        {eventBodyText(event)}
      </pre>
    </details>
  );
}

function CloudRunEventDetails({
  type,
  payload,
  event,
}: {
  type: string | undefined;
  payload: EventPayload;
  event: BackgroundTaskCloudRunEventType["event"];
}) {
  const eventType = type ?? payloadString(payload, "type") ?? "";
  const known =
    eventType.startsWith("runtime.tool") ||
    eventType.startsWith("runtime.llm") ||
    eventType.startsWith("temporal.") ||
    eventType === "runtime.limit_exceeded" ||
    eventType === "runtime.final_artifact_ready";

  if (eventType.startsWith("runtime.tool")) {
    return (
      <div className="space-y-2">
        <RuntimeEventDetails payload={payload} />
        <RawEventDetails event={event} />
      </div>
    );
  }
  if (eventType.startsWith("runtime.llm")) {
    return (
      <div className="space-y-2">
        <LLMEventDetails payload={payload} />
        <RawEventDetails event={event} />
      </div>
    );
  }
  if (
    eventType.startsWith("temporal.") ||
    eventType === "runtime.limit_exceeded" ||
    eventType === "runtime.final_artifact_ready"
  ) {
    return (
      <div className="space-y-2">
        <TemporalEventDetails payload={payload} />
        <RawEventDetails event={event} />
      </div>
    );
  }
  if (known) {
    return <RawEventDetails event={event} />;
  }
  return <RawEventDetails event={event} />;
}

function TraceStat({
  icon,
  label,
  value,
  title,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0 border-t border-border px-3 py-2.5 sm:border-t-0 sm:border-l">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 min-w-0 truncate text-xs text-foreground" title={title}>
        {value}
      </div>
    </div>
  );
}

function CloudRunTraceOverview({
  runId,
  status,
  run,
  events,
}: {
  runId: string;
  status: BackgroundTaskCloudRunStatusType | null;
  run: BackgroundTaskCloudRunType | null;
  events: BackgroundTaskCloudRunEventType[];
}) {
  const startedAt = status?.startedAt ?? run?.startedAt ?? null;
  const completedAt = status?.completedAt ?? run?.completedAt ?? null;
  const eventCount = events.length;
  const duration = durationBetween(startedAt, completedAt) ?? durationAcrossEvents(events);
  const durationLabel =
    duration ?? (status && isTerminalCloudStatus(status.status) ? "unknown" : "pending");
  const statusLabel = status?.status ?? "loading";
  const trigger = run ? triggeredByLabel(run) : "loading";
  const workflowId = status?.temporalWorkflowId ?? run?.temporalWorkflowId;
  const workflowTitle = workflowId
    ? status?.temporalRunId
      ? `${workflowId} / ${status.temporalRunId}`
      : workflowId
    : undefined;

  return (
    <section className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
          <Workflow className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Cloud trace
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium ${cloudStatusTone(status?.status)}`}
            >
              <span className={`size-1.5 rounded-full ${cloudStatusDot(status?.status)}`} />
              {statusLabel}
              {status?.temporalStatus ? ` · ${status.temporalStatus}` : ""}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-foreground" title={runId}>
            {runId}
          </div>
          {status?.progressMessage && (
            <div
              className="mt-1 truncate text-[11px] text-muted-foreground"
              title={status.progressMessage}
            >
              {status.progressMessage}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold leading-none text-foreground">{eventCount}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            events
          </div>
        </div>
      </div>

      <div className="grid bg-muted/10 sm:grid-cols-4">
        <TraceStat
          icon={<Zap className="size-3" />}
          label="Trigger"
          value={trigger}
          title={trigger}
        />
        <TraceStat icon={<Clock className="size-3" />} label="Duration" value={durationLabel} />
        <TraceStat
          icon={<Play className="size-3" />}
          label="Started"
          value={startedAt ? formatRunAt(startedAt) : "pending"}
          title={startedAt ?? undefined}
        />
        <TraceStat
          icon={<CheckCircle2 className="size-3" />}
          label="Workflow"
          value={workflowId ?? "not linked"}
          title={workflowTitle}
        />
      </div>
    </section>
  );
}

function CloudRunTraceEvent({
  event,
  firstReceivedAt,
  isFirst,
  isLast,
}: {
  event: BackgroundTaskCloudRunEventType;
  firstReceivedAt: string | null;
  isFirst: boolean;
  isLast: boolean;
}) {
  const payload = eventPayload(event.event);
  const eventType = event.type ?? payloadString(payload, "type") ?? undefined;
  const title = cloudEventTitle(eventType, payload);
  const stage = cloudEventStageLabel(eventType, payload);
  const outcome = cloudEventOutcome(eventType, payload);
  const summary = cloudEventSummary(eventType, payload, event.event);
  const offset = formatTraceOffset(firstReceivedAt, event.receivedAt);
  const latency = formatMs(payloadNumber(payload, "latencyMs"));
  const bytes =
    formatBytes(payloadNumber(payload, "artifactBytes")) ??
    formatBytes(payloadNumber(payload, "resultBytes")) ??
    formatBytes(payloadNumber(payload, "sandboxOutputBytes"));
  const chipValues = [
    `#${event.seq}`,
    stage,
    offset,
    latency,
    bytes,
    payloadString(payload, "tool"),
    payloadString(payload, "model"),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
      <div className="relative flex justify-center">
        {!isFirst && <span className="absolute top-0 h-3 w-px bg-border" aria-hidden />}
        {!isLast && <span className="absolute bottom-0 top-9 w-px bg-border" aria-hidden />}
        <div
          className={`relative z-10 mt-2 flex size-7 items-center justify-center rounded-full border ${outcome.nodeClassName}`}
        >
          <CloudEventIcon type={eventType} payload={payload} />
        </div>
      </div>

      <div className="min-w-0 pb-3">
        <div className="rounded-md border border-border/80 bg-background px-3 py-2.5">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`min-w-0 truncate text-xs font-medium ${cloudEventTone(eventType, payload)}`}
                >
                  {title}
                </span>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${outcome.className}`}
                >
                  {outcome.label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {chipValues.map((value) => (
                  <span
                    key={value}
                    className="max-w-[180px] truncate rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    title={value}
                  >
                    {value}
                  </span>
                ))}
                {eventType && (
                  <span
                    className="max-w-[220px] truncate rounded bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    title={eventType}
                  >
                    {eventType}
                  </span>
                )}
              </div>
            </div>
            <div
              className="shrink-0 font-mono text-[10px] text-muted-foreground"
              title={event.receivedAt}
            >
              {formatRunAt(event.receivedAt)}
            </div>
          </div>

          {summary && (
            <div
              className="mt-2 truncate text-[11px] leading-relaxed text-foreground/75"
              title={summary}
            >
              {summary}
            </div>
          )}

          <div className="mt-2 border-t border-border/60 pt-2">
            <CloudRunEventDetails type={eventType} payload={payload} event={event.event} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CloudRunTraceTimeline({ events }: { events: BackgroundTaskCloudRunEventType[] }) {
  const firstReceivedAt = firstEventTimestamp(events);
  return (
    <div>
      {events.map((event, index) => (
        <CloudRunTraceEvent
          key={event.id}
          event={event}
          firstReceivedAt={firstReceivedAt}
          isFirst={index === 0}
          isLast={index === events.length - 1}
        />
      ))}
    </div>
  );
}

function TriggersEditor({
  value,
  onChange,
}: {
  value: Triggers | undefined;
  onChange: (next: Triggers | undefined) => void;
}) {
  const triggers: Triggers = value ?? {};
  const [editingEvents, setEditingEvents] = useState(false);
  const hasCron = typeof triggers.cronExpr === "string";
  const hasWindows = Array.isArray(triggers.windows) && triggers.windows.length > 0;
  const hasEvent = typeof triggers.eventMatchCriteria === "string";

  const updateTriggers = (next: Partial<Triggers>) => {
    const merged: Triggers = { ...triggers, ...next };
    (Object.keys(merged) as (keyof Triggers)[]).forEach((key) => {
      if (merged[key] === undefined) delete merged[key];
    });
    onChange(Object.keys(merged).length === 0 ? undefined : merged);
  };

  return (
    <div className="grid grid-cols-[74px_1fr] items-start gap-x-3 gap-y-4">
      <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
        <Repeat className="size-3.5" /> Cron
      </div>
      <div>
        {hasCron ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Input
                value={triggers.cronExpr ?? ""}
                onChange={(e) => updateTriggers({ cronExpr: e.target.value })}
                placeholder="0 * * * *"
                className="h-7 max-w-[160px] font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => updateTriggers({ cronExpr: undefined })}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Remove cron"
              >
                <X className="size-3" />
              </button>
            </div>
            {triggers.cronExpr && (
              <div className="text-[11px] text-muted-foreground">
                {describeCron(triggers.cronExpr)}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => updateTriggers({ cronExpr: "0 * * * *" })}
            className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> Cron
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" /> Windows
      </div>
      <div>
        {hasWindows && triggers.windows ? (
          <div className="space-y-1.5">
            {triggers.windows.map((w, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <Input
                  value={w.startTime}
                  onChange={(e) => {
                    const next = [...(triggers.windows ?? [])];
                    next[idx] = { ...next[idx], startTime: e.target.value };
                    updateTriggers({ windows: next });
                  }}
                  placeholder="09:00"
                  className={`h-7 w-20 font-mono text-xs ${HH_MM.test(w.startTime) ? "" : "border-destructive"}`}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  value={w.endTime}
                  onChange={(e) => {
                    const next = [...(triggers.windows ?? [])];
                    next[idx] = { ...next[idx], endTime: e.target.value };
                    updateTriggers({ windows: next });
                  }}
                  placeholder="12:00"
                  className={`h-7 w-20 font-mono text-xs ${HH_MM.test(w.endTime) ? "" : "border-destructive"}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = (triggers.windows ?? []).filter((_, i) => i !== idx);
                    updateTriggers({
                      windows: next.length === 0 ? undefined : next,
                    });
                  }}
                  className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Remove window"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                updateTriggers({
                  windows: [...(triggers.windows ?? []), { startTime: "13:00", endTime: "15:00" }],
                })
              }
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3" /> Window
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              updateTriggers({
                windows: [{ startTime: "09:00", endTime: "12:00" }],
              })
            }
            className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> Window
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
        <Zap className="size-3.5" /> Events
      </div>
      <div>
        {hasEvent ? (
          editingEvents ? (
            <div className="space-y-1.5">
              <Textarea
                value={triggers.eventMatchCriteria ?? ""}
                onChange={(e) => updateTriggers({ eventMatchCriteria: e.target.value })}
                rows={5}
                autoFocus
                placeholder="Emails or calendar events about…"
                className="text-xs"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingEvents(false)}
                  className="text-[11px] font-medium text-foreground hover:underline"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateTriggers({ eventMatchCriteria: undefined });
                    setEditingEvents(false);
                  }}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs leading-relaxed text-foreground/85">
              {triggers.eventMatchCriteria || (
                <span className="italic text-muted-foreground">No criteria yet.</span>
              )}
              <button
                type="button"
                onClick={() => setEditingEvents(true)}
                className="ml-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                {triggers.eventMatchCriteria ? "Edit rule →" : "Add →"}
              </button>
            </div>
          )
        ) : (
          <button
            type="button"
            onClick={() => {
              updateTriggers({ eventMatchCriteria: "" });
              setEditingEvents(true);
            }}
            className="inline-flex items-center gap-1 pt-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> Event rule
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Task dialog
// ---------------------------------------------------------------------------

type DialogMode = "describe" | "manual";

function NewTaskDialog({
  open,
  onClose,
  onCreated,
  onCreateWithCopilot,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string, executionTarget: ExecutionTarget) => void;
  /**
   * Optional Copilot hand-off. When provided, the dialog opens in
   * free-form "describe" mode and the user can punt to Copilot with a
   * single-sentence description. Falls back to the manual form if absent.
   */
  onCreateWithCopilot?: (description: string) => void;
}) {
  const copilotEnabled = Boolean(onCreateWithCopilot);
  const [mode, setMode] = useState<DialogMode>(copilotEnabled ? "describe" : "manual");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [triggers, setTriggers] = useState<Triggers | undefined>(undefined);
  const [executionTarget, setExecutionTarget] = useState<ExecutionTarget>("desktop");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(copilotEnabled ? "describe" : "manual");
      setDescription("");
      setName("");
      setInstructions("");
      setTriggers(undefined);
      setExecutionTarget("desktop");
    }
  }, [open, copilotEnabled]);

  const canSubmitDescribe = description.trim().length > 0 && !submitting;
  const canSubmitManual = name.trim().length > 0 && instructions.trim().length > 0 && !submitting;

  const submitDescribe = () => {
    if (!canSubmitDescribe || !onCreateWithCopilot) return;
    onCreateWithCopilot(description.trim());
    onClose();
  };

  const submitManual = async () => {
    if (!canSubmitManual) return;
    setSubmitting(true);
    try {
      const result = await window.ipc.invoke("bg-task:create", {
        name: name.trim(),
        instructions: instructions.trim(),
        ...(triggers ? { triggers } : {}),
        executionTarget,
      });
      if (result.success && result.slug) {
        onCreated(result.slug, executionTarget);
      } else {
        toast(result.error ?? "Failed to create task", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-background-task-title"
        aria-describedby="new-background-task-description"
        className="w-full max-w-xl rounded-none border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="new-background-task-title" className="text-base font-semibold">
            New background task
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close new background task dialog"
          >
            <X className="size-4" />
          </button>
        </div>
        <p id="new-background-task-description" className="sr-only">
          Create a background task by describing it to Copilot or configuring the name,
          instructions, execution target, and triggers manually.
        </p>

        {mode === "describe" ? (
          <>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submitDescribe();
                }
              }}
              placeholder="Describe what this task should do — when it should fire, what it should produce or which action it should take. Copilot will fill in the rest.

Example: every morning at 7, summarize my unread Gmail into a one-paragraph brief plus a bulleted list of action items."
              rows={8}
              autoFocus
              className="resize-y text-[13px] leading-relaxed"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Tip: be specific about the cadence and the format you want.{" "}
              <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">⌘↵</kbd> to
              submit.
            </p>

            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  // Don't drop what the user already typed — seed the manual
                  // instructions with it (unless they've edited those already).
                  if (description.trim() && !instructions.trim()) {
                    setInstructions(description.trim());
                  }
                  setMode("manual");
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Configure manually →
              </button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button size="sm" onClick={submitDescribe} disabled={!canSubmitDescribe}>
                  <Sparkles className="size-3" /> Set up with Copilot
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Morning weather brief"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Instructions
                </label>
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Show SF weather as one line: `<temp>°F, <conditions>`"
                  rows={4}
                  className="font-mono text-[12.5px]"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The agent reads the verbs each run to decide whether to update{" "}
                  <code className="font-mono">index.md</code> (OUTPUT) or perform an action and
                  journal it (ACTION).
                </p>
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Execution
                </label>
                <ExecutionTargetControl
                  value={executionTarget}
                  onChange={setExecutionTarget}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Triggers
                </label>
                <TriggersEditor value={triggers} onChange={setTriggers} />
                <p className="mt-2 text-[11px] text-muted-foreground">No triggers = manual-only.</p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              {copilotEnabled ? (
                <button
                  type="button"
                  onClick={() => setMode("describe")}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  ← Describe instead
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button size="sm" onClick={submitManual} disabled={!canSubmitManual}>
                  {submitting && <Loader2 className="mr-1 size-3 animate-spin" />}
                  Create
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI bits
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative px-3 py-2.5 text-xs font-medium transition-colors ${
        active
          ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground"
          : disabled
            ? "text-muted-foreground/50 cursor-not-allowed"
            : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SectionRegion({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-sidebar-border px-4 py-4 last:border-b-0">
      {label && (
        <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

function ExecutionTargetControl({
  value,
  onChange,
  disabled,
}: {
  value: ExecutionTarget;
  onChange: (next: ExecutionTarget) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-none border border-border bg-background">
      <button
        type="button"
        onClick={() => onChange("desktop")}
        disabled={disabled}
        aria-pressed={value === "desktop"}
        className={`flex h-9 items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
          value === "desktop"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        }`}
      >
        <Laptop className="size-3.5" /> Desktop
      </button>
      <button
        type="button"
        onClick={() => onChange("api")}
        disabled={disabled}
        aria-pressed={value === "api"}
        className={`flex h-9 items-center justify-center gap-1.5 border-l border-border text-xs font-medium transition-colors ${
          value === "api"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        }`}
      >
        <Cloud className="size-3.5" /> API worker
      </button>
      <div className="col-span-2 border-t border-border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {value === "api"
          ? "Scheduled runs happen in the cloud, even when this app is closed."
          : "Scheduled runs require this app to be open."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Output pane — index.md (main pane content)
//
// Renders the task's `index.md` like a note: max-width 720px centered, same
// typography (~16px, 1.5 line-height, generous padding) as the note editor's
// ProseMirror rule in `editor.css`. No chrome above the body — just the
// markdown, with a small floating Source ⇄ Rendered toggle in the top-right.
// ---------------------------------------------------------------------------

function OutputPane({
  slug,
  taskName,
  refreshKey,
}: {
  slug: string;
  taskName: string;
  refreshKey: number;
}) {
  const [body, setBody] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [viewSource, setViewSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await window.ipc.invoke("workspace:readFile", {
          path: `bg-tasks/${slug}/index.md`,
        });
        if (!cancelled) setBody(result.data);
      } catch {
        if (!cancelled) setBody("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, refreshKey]);

  const isEmpty = !body.trim() || body.trim() === `# ${taskName}`;

  return (
    <div className="relative flex-1 overflow-hidden bg-background">
      {!isEmpty && !loading && (
        <button
          type="button"
          onClick={() => setViewSource((v) => !v)}
          className="absolute right-4 top-3 z-10 rounded-none bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground backdrop-blur hover:bg-accent hover:text-foreground"
          aria-label={viewSource ? "Show rendered output" : "Show source markdown"}
        >
          {viewSource ? "Rendered" : "Source"}
        </button>
      )}

      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-16 py-8">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </div>
          ) : isEmpty ? (
            <p className="text-sm italic text-muted-foreground">
              No output yet. Click <span className="font-medium text-foreground">Run now</span> in
              the sidebar, or wait for a trigger to fire.
            </p>
          ) : viewSource ? (
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
              {body}
            </pre>
          ) : (
            <RichMarkdownViewer content={body} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup tab — Instructions + Triggers + Advanced
// ---------------------------------------------------------------------------

function InstructionsBlock({
  draft,
  setDraft,
  editing,
  setEditing,
  onCancel,
  onSave,
  saving,
  dirty,
}: {
  draft: BackgroundTask;
  setDraft: (next: BackgroundTask) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [editing]);

  if (editing) {
    return (
      <div className="space-y-2">
        <Textarea
          ref={textareaRef}
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          spellCheck
          placeholder="What should this task keep doing?"
          rows={8}
          className="resize-y font-mono text-[12.5px] leading-relaxed"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}{" "}
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Instructions
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" /> Edit
        </button>
      </div>
      {draft.instructions.trim() ? (
        <Streamdown className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          {draft.instructions}
        </Streamdown>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          No instructions yet. Click Edit to write some.
        </p>
      )}
    </div>
  );
}

function SetupTab({
  draft,
  setDraft,
  editingInstructions,
  setEditingInstructions,
  onCancelInstructions,
  onSave,
  saving,
  dirty,
  showAdvanced,
  setShowAdvanced,
  confirmingDelete,
  setConfirmingDelete,
  onDelete,
}: {
  draft: BackgroundTask;
  setDraft: (next: BackgroundTask) => void;
  editingInstructions: boolean;
  setEditingInstructions: (v: boolean) => void;
  onCancelInstructions: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  confirmingDelete: boolean;
  setConfirmingDelete: (v: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex-1 overflow-auto">
      <SectionRegion>
        <InstructionsBlock
          draft={draft}
          setDraft={setDraft}
          editing={editingInstructions}
          setEditing={setEditingInstructions}
          onCancel={onCancelInstructions}
          onSave={onSave}
          saving={saving}
          dirty={dirty}
        />
      </SectionRegion>

      <SectionRegion label="Execution">
        <ExecutionTargetControl
          value={executionTargetOf(draft)}
          onChange={(next) => setDraft({ ...draft, executionTarget: next })}
          disabled={saving}
        />
      </SectionRegion>

      <SectionRegion label="Triggers">
        <TriggersEditor
          value={draft.triggers}
          onChange={(next) => setDraft({ ...draft, triggers: next })}
        />
      </SectionRegion>

      <div className="border-b border-sidebar-border px-4 py-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Advanced
        </button>
        {showAdvanced && (
          <div className="mt-3">
            <div className="grid grid-cols-[74px_1fr] gap-x-3 gap-y-2.5 text-xs">
              <span className="pt-1.5 text-muted-foreground">Model</span>
              <Input
                value={draft.model ?? ""}
                onChange={(e) => setDraft({ ...draft, model: e.target.value || undefined })}
                placeholder="(global default)"
                className="h-7 font-mono text-xs"
              />
              <span className="pt-1.5 text-muted-foreground">Provider</span>
              <Input
                value={draft.provider ?? ""}
                onChange={(e) => setDraft({ ...draft, provider: e.target.value || undefined })}
                placeholder="(global default)"
                className="h-7 font-mono text-xs"
              />
            </div>
            <div className="mt-4">
              {confirmingDelete ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-none border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                  <span className="text-destructive">Delete this task and all its runs?</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button variant="destructive" size="sm" onClick={onDelete} disabled={saving}>
                      {saving ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}{" "}
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="text-xs font-medium text-destructive hover:underline"
                >
                  Delete task →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runs history tab — list + drill-down transcript view
//
// Source of truth: `bg-tasks/<slug>/runs.log` — a plain-text file with one
// runId per line (newest first). The actual transcripts live at the global
// `$WorkDir/runs/<runId>.jsonl`, so this tab fetches runIds via the bg-task
// IPC, then loads each Run through the standard `runs:fetch`. No bg-task-
// specific transcript path or schema needed.
// ---------------------------------------------------------------------------

interface RunRowSummary {
  runId: string;
  createdAt?: string;
  trigger?: string;
  summary?: string;
  error?: string;
}

// Pull the bits we want to display for a row out of a full Run's event log.
function summarizeRun(run: z.infer<typeof Run>): RunRowSummary {
  const out: RunRowSummary = {
    runId: run.id,
    createdAt: run.createdAt,
    trigger: run.subUseCase,
  };
  for (const event of run.log) {
    if (event.type === "error" && typeof event.error === "string") {
      out.error = event.error;
    } else if (event.type === "message" && event.message?.role === "assistant") {
      const content = event.message.content;
      if (typeof content === "string") {
        out.summary = content;
      } else if (Array.isArray(content)) {
        const text = content
          .filter((p) => p.type === "text")
          .map((p) => ("text" in p ? p.text : ""))
          .join("");
        if (text) out.summary = text;
      }
    }
  }
  return out;
}

function RunsHistoryTab({ slug, task }: { slug: string; task: BackgroundTask }) {
  if (executionTargetOf(task) === "api") {
    return <CloudRunsHistoryTab slug={slug} />;
  }
  return <LocalRunsHistoryTab slug={slug} task={task} />;
}

function LocalRunsHistoryTab({ slug, task }: { slug: string; task: BackgroundTask }) {
  const [rows, setRows] = useState<RunRowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const agentStatus = useBackgroundTaskAgentStatus();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { runIds } = await window.ipc.invoke("bg-task:listRunIds", {
        slug,
        limit: 100,
      });
      // Fetch each Run in parallel via the canonical IPC. Runs whose
      // jsonl no longer exists (deleted manually, never written, …) are
      // dropped silently.
      const settled = await Promise.allSettled(
        runIds.map((runId) => window.ipc.invoke("runs:fetch", { runId })),
      );
      const next: RunRowSummary[] = [];
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === "fulfilled" && r.value) {
          next.push(summarizeRun(r.value));
        } else {
          // Keep the row visible with just the id so the user knows it exists.
          next.push({ runId: runIds[i] });
        }
      }
      setRows(next);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-load whenever a new attempt starts or finishes (flat-field changes).
  useEffect(() => {
    void load();
  }, [task.lastRunId, task.lastAttemptAt, task.lastRunAt, load]);

  // Bus events are the ONLY source of truth for in-flight status. If the
  // renderer received a `start` event for this task and hasn't yet received
  // its `complete`, the run with that runId is running. Disk-derived signals
  // (lastAttemptAt vs lastRunAt) are deliberately ignored — even if it means
  // the UI is briefly out of sync after a late start or a missed event.
  const liveStatus = agentStatus.get(slug);
  const currentInFlightRunId = liveStatus?.status === "running" ? (liveStatus.runId ?? null) : null;

  if (selectedRunId) {
    return (
      <RunTranscriptView
        runId={selectedRunId}
        isInFlight={selectedRunId === currentInFlightRunId}
        onBack={() => setSelectedRunId(null)}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-xs text-muted-foreground">
            No runs yet. Click <span className="font-medium text-foreground">Run now</span> below.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-sidebar-border">
          {rows.map((row) => {
            const inFlight = row.runId === currentInFlightRunId;
            const isError = !!row.error;
            return (
              <button
                key={row.runId}
                type="button"
                onClick={() => setSelectedRunId(row.runId)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/30"
              >
                <div
                  className={`size-1.5 shrink-0 rounded-full ${
                    inFlight
                      ? "bg-amber-500 animate-pulse"
                      : isError
                        ? "bg-destructive"
                        : "bg-emerald-500"
                  }`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {row.createdAt ? formatRunAt(row.createdAt) : row.runId}
                    </span>
                    {row.trigger && (
                      <>
                        <span className="text-[10.5px] text-muted-foreground">·</span>
                        <span className="text-[10.5px] text-muted-foreground">{row.trigger}</span>
                      </>
                    )}
                    {inFlight && <span className="text-[10.5px] text-amber-600">· running</span>}
                  </div>
                  {(row.error || row.summary) && (
                    <div
                      className={`truncate text-[11px] ${row.error ? "text-destructive" : "text-foreground/70"}`}
                    >
                      {row.error ?? row.summary}
                    </div>
                  )}
                </div>
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RunTranscriptView({
  runId,
  isInFlight,
  onBack,
}: {
  runId: string;
  isInFlight: boolean;
  onBack: () => void;
}) {
  const [run, setRun] = useState<z.infer<typeof Run> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        // Bg-task transcripts now live at the global runs/ location —
        // same path resolution as every other run, no special handling.
        const r = await window.ipc.invoke("runs:fetch", { runId });
        if (cancelled) return;
        setRun(r);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRun(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const summary = run ? summarizeRun(run) : undefined;
  const items: ConversationItem[] = run ? runLogToConversation(run.log) : [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to runs"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10.5px] text-muted-foreground">
            {summary?.createdAt ? formatRunAt(summary.createdAt) : runId}
            {summary?.trigger && ` · ${summary.trigger}`}
            {isInFlight && <span className="ml-1 text-amber-600">· running</span>}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        {/* Summary header — error or summary, mirrors live-note LastRunTab. */}
        <div>
          {summary?.error && (
            <div className="mb-3 flex items-start gap-2 rounded-none border border-destructive/30 bg-destructive/5 px-2.5 py-2">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <code className="break-all font-mono text-[11px] leading-relaxed text-destructive">
                {summary.error}
              </code>
            </div>
          )}
          {summary?.summary && (
            <Streamdown className="prose prose-sm dark:prose-invert max-w-none text-foreground/85 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2">
              {summary.summary}
            </Streamdown>
          )}
          {!summary?.error && !summary?.summary && !loading && (
            <p className="text-xs italic text-muted-foreground">No summary recorded.</p>
          )}
        </div>

        <div className="border-t border-sidebar-border" />

        {/* Transcript */}
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Transcript
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-none border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Couldn&apos;t load transcript: {error}
            </div>
          )}
          {run && !loading && items.length === 0 && (
            <p className="text-xs italic text-muted-foreground">
              No messages or tool calls recorded.
            </p>
          )}
          {run && !loading && items.length > 0 && <CompactConversation items={items} />}
        </div>
      </div>
    </div>
  );
}

function CloudRunsHistoryTab({ slug }: { slug: string }) {
  const [rows, setRows] = useState<BackgroundTaskCloudRunType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const load = useCallback(async (
    cursor?: string,
    mode: "replace" | "append" | "refresh" = "replace",
  ) => {
    if (mode === "append") {
      setLoadingMore(true);
    } else if (mode === "replace") {
      setLoading(true);
    }
    try {
      const result = await window.ipc.invoke("bg-task:listCloudRuns", {
        slug,
        executor: "api",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (result.success) {
        setRows((current) => {
          if (mode === "replace") return result.runs;
          const ordered = mode === "append" ? [...current, ...result.runs] : [...result.runs, ...current];
          return [...new Map(ordered.map((run) => [run.runId, run])).values()];
        });
        if (mode !== "refresh") {
          setNextCursor(result.nextCursor ?? null);
        }
        setError(null);
      } else {
        setError(result.error ?? "Could not load API-worker runs.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API-worker runs.");
    } finally {
      if (mode === "append") {
        setLoadingMore(false);
      } else if (mode === "replace") {
        setLoading(false);
      }
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!rows.some((row) => !isTerminalCloudStatus(row.status))) return;
    const interval = window.setInterval(() => {
      void load(undefined, "refresh");
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [load, rows]);

  if (selectedRunId) {
    return (
      <CloudRunTranscriptView
        slug={slug}
        runId={selectedRunId}
        onBack={() => {
          setSelectedRunId(null);
          void load();
        }}
        onSelectRun={setSelectedRunId}
        onChanged={load}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="px-4 py-4 text-xs text-destructive">{error}</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-xs text-muted-foreground">No API-worker runs yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-sidebar-border">
          {rows.map((row) => (
            <button
              key={row.runId}
              type="button"
              onClick={() => setSelectedRunId(row.runId)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/30"
            >
              <div className={`size-1.5 shrink-0 rounded-full ${cloudStatusDot(row.status)}`} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {row.createdAt ? formatRunAt(row.createdAt) : row.runId}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">·</span>
                  <span className={`text-[10.5px] ${cloudStatusTone(row.status)}`}>
                    {row.status}
                  </span>
                  {row.trigger && (
                    <>
                      <span className="text-[10.5px] text-muted-foreground">·</span>
                      <span className="text-[10.5px] text-muted-foreground">{row.trigger}</span>
                    </>
                  )}
                  {typeof row.progressPercent === "number" && (
                    <>
                      <span className="text-[10.5px] text-muted-foreground">·</span>
                      <span className="text-[10.5px] text-muted-foreground">
                        {row.progressPercent}%
                      </span>
                    </>
                  )}
                </div>
                {(row.error || row.progressMessage || row.summary) && (
                  <div
                    className={`truncate text-[11px] ${row.error ? "text-destructive" : "text-foreground/70"}`}
                  >
                    {row.error ?? row.progressMessage ?? row.summary}
                  </div>
                )}
                {row.temporalWorkflowId && (
                  <div
                    className="truncate font-mono text-[10px] text-muted-foreground/80"
                    title={row.temporalWorkflowId}
                  >
                    {row.temporalStatus ? `${row.temporalStatus} · ` : ""}
                    {row.temporalWorkflowId}
                  </div>
                )}
              </div>
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {nextCursor ? (
            <div className="flex justify-center px-4 py-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void load(nextCursor, "append")}
              >
                {loadingMore ? <Loader2 className="size-3 animate-spin" /> : null}
                Load more runs
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CloudRunTranscriptView({
  slug,
  runId,
  onBack,
  onSelectRun,
  onChanged,
}: {
  slug: string;
  runId: string;
  onBack: () => void;
  onSelectRun: (runId: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<BackgroundTaskCloudRunStatusType | null>(null);
  const [events, setEvents] = useState<BackgroundTaskCloudRunEventType[]>([]);
  const [run, setRun] = useState<BackgroundTaskCloudRunType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  // The run/status type carries no paused indicator (pause/resume are workflow
  // control signals), so track it locally from the last signal sent so we can
  // show only the applicable control instead of both. // ... (ERRORS.md E35)
  const [paused, setPaused] = useState(false);

  // One-shot run detail (trigger + originating cloud event): immutable data,
  // deliberately outside the 2s status poll. Best-effort — a failure just
  // omits the "Triggered by" line.
  useEffect(() => {
    let cancelled = false;
    setRun(null);
    void window.ipc.invoke("bg-task:getCloudRun", { slug, runId }).then((result) => {
      if (!cancelled && result.success && result.run) setRun(result.run);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, runId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResult, eventsResult] = await Promise.all([
        window.ipc.invoke("bg-task:getCloudRunStatus", { slug, runId }),
        window.ipc.invoke("bg-task:listCloudRunEvents", { slug, runId }),
      ]);
      if (statusResult.success && statusResult.status) {
        setStatus(statusResult.status);
      } else if (!statusResult.success) {
        setError(statusResult.error ?? "Could not load API-worker run status.");
      }
      if (eventsResult.success) {
        setEvents(eventsResult.events);
      } else {
        setError(eventsResult.error ?? "Could not load API-worker run events.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load API-worker run.");
    } finally {
      setLoading(false);
    }
  }, [runId, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status || isTerminalCloudStatus(status.status)) return;
    const interval = window.setInterval(() => {
      void load();
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [load, status]);

  const cancelRun = async () => {
    setActioning("cancel");
    try {
      const result = await window.ipc.invoke("bg-task:cancelCloudRun", {
        slug,
        runId,
      });
      if (result.success && result.run) {
        setStatus(cloudRunStatusFromRun(result.run));
        onChanged();
      } else {
        toast(result.error ?? "Cancel failed", "error");
      }
    } finally {
      setActioning(null);
    }
  };

  const retryRun = async () => {
    setActioning("retry");
    try {
      const result = await window.ipc.invoke("bg-task:retryCloudRun", {
        slug,
        runId,
      });
      if (result.success && result.run) {
        onSelectRun(result.run.runId);
        onChanged();
      } else {
        toast(result.error ?? "Retry failed", "error");
      }
    } finally {
      setActioning(null);
    }
  };

  // Rerun is distinct from retry: it starts a fresh `manual` run reusing the
  // original requested context (no retry lineage), and is offered for ANY
  // terminal run — including successful ones — whereas retry is only for
  // failed/stopped runs.
  const rerunRun = async () => {
    setActioning("rerun");
    try {
      const result = await window.ipc.invoke("bg-task:rerunCloudRun", {
        slug,
        runId,
      });
      if (result.success && result.run) {
        onSelectRun(result.run.runId);
        onChanged();
      } else {
        toast(result.error ?? "Rerun failed", "error");
      }
    } finally {
      setActioning(null);
    }
  };

  const signalRun = async (signal: "pause" | "resume") => {
    setActioning(signal);
    try {
      const result = await window.ipc.invoke("bg-task:signalCloudRun", {
        slug,
        runId,
        signal,
      });
      if (result.success && result.run) {
        setStatus(cloudRunStatusFromRun(result.run));
        setPaused(signal === "pause"); // ... (ERRORS.md E35)
        onChanged();
      } else {
        toast(result.error ?? "Signal failed", "error");
      }
    } finally {
      setActioning(null);
    }
  };

  const active = status ? !isTerminalCloudStatus(status.status) : false;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to runs"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">{runId}</div>
          {status && (
            <div className={`text-[10.5px] ${cloudStatusTone(status.status)}`}>
              {status.status}
              {status.temporalStatus ? ` · ${status.temporalStatus}` : ""}
              {typeof status.progressPercent === "number" ? ` · ${status.progressPercent}%` : ""}
            </div>
          )}
        </div>
        {active && (
          <>
            {/* Show only the applicable control for the current run state. // ... (ERRORS.md E35) */}
            {paused ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void signalRun("resume");
                }}
                disabled={!!actioning}
              >
                {actioning === "resume" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}{" "}
                Resume
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void signalRun("pause");
                }}
                disabled={!!actioning}
              >
                {actioning === "pause" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Pause className="size-3" />
                )}{" "}
                Pause
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void cancelRun();
              }}
              disabled={!!actioning}
            >
              {actioning === "cancel" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Square className="size-3" />
              )}{" "}
              Stop
            </Button>
          </>
        )}
        {!active && status && (
          <>
            {(status.status === "failed" || status.status === "stopped") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void retryRun();
                }}
                disabled={!!actioning}
                title="Re-execute this run (linked retry, attempt bumped)"
              >
                {actioning === "retry" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RotateCcw className="size-3" />
                )}{" "}
                Retry
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void rerunRun();
              }}
              disabled={!!actioning}
              title="Start a fresh run with the same context (not a retry)"
            >
              {actioning === "rerun" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Repeat className="size-3" />
              )}{" "}
              Rerun
            </Button>
          </>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        {(status?.error || status?.errorCode) && (
          <div className="rounded-none border border-destructive/30 bg-destructive/5 px-2.5 py-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1 space-y-1">
                {status?.errorCode && (
                  <span className="inline-block rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-destructive">
                    {status.errorCode}
                  </span>
                )}
                {(status?.errorDetails || status?.error) && (
                  <code className="block break-all font-mono text-[11px] leading-relaxed text-destructive">
                    {status.errorDetails || status.error}
                  </code>
                )}
              </div>
            </div>
          </div>
        )}

        <CloudRunTraceOverview runId={runId} status={status} run={run} events={events} />

        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Trace events
            </div>
            <div className="h-px flex-1 bg-sidebar-border" />
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </div>
          )}
          {error && !loading && (
            <div className="rounded-none border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          {!loading && events.length === 0 && !error && (
            <p className="text-xs italic text-muted-foreground">No mirrored events recorded.</p>
          )}
          {!loading && events.length > 0 && <CloudRunTraceTimeline events={events} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right sidebar — header + status strip + tabs + footer (mirror of live-note)
// ---------------------------------------------------------------------------

type Tab = "setup" | "runs";

function ControlSidebar({
  slug,
  task,
  draft,
  setDraft,
  isRunning,
  paused,
  saving,
  dirty,
  editingInstructions,
  setEditingInstructions,
  onCancelInstructions,
  onSave,
  showAdvanced,
  setShowAdvanced,
  confirmingDelete,
  setConfirmingDelete,
  onToggleActive,
  onRunNow,
  onStop,
  onDelete,
  onCollapse,
  onEditWithCopilot,
  cloudRunStatus,
  artifactSync,
  onPullArtifact,
  pullingArtifact,
}: {
  slug: string;
  task: BackgroundTask;
  draft: BackgroundTask;
  setDraft: (next: BackgroundTask) => void;
  isRunning: boolean;
  paused: boolean;
  saving: boolean;
  dirty: boolean;
  editingInstructions: boolean;
  setEditingInstructions: (v: boolean) => void;
  onCancelInstructions: () => void;
  onSave: () => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  confirmingDelete: boolean;
  setConfirmingDelete: (v: boolean) => void;
  onToggleActive: (v: boolean) => void;
  onRunNow: () => void;
  onStop: () => void;
  onDelete: () => void;
  onCollapse: () => void;
  onEditWithCopilot?: () => void;
  cloudRunStatus?: BackgroundTaskCloudRunStatusType | null;
  artifactSync?: BackgroundTaskArtifactSyncType | null;
  onPullArtifact?: () => void;
  pullingArtifact?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("setup");
  const mode = executionTargetOf(task);
  const { scheduleState, scheduleError, reloadScheduleState } = useCloudScheduleState(
    slug,
    mode,
    !!task.triggers,
  );

  const lastRunLabel = task.lastRunAt
    ? (relativeLabel(task.lastRunAt) ?? "recently")
    : task.lastAttemptAt
      ? `started ${relativeLabel(task.lastAttemptAt) ?? "just now"}`
      : "Never";

  return (
    <aside className="flex w-[400px] max-w-[40vw] shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
        <ListChecks
          className={`size-4 shrink-0 ${paused ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"}`}
        />
        <span className="truncate text-sm font-semibold">{task.name}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {mode === "api" ? <Cloud className="size-3" /> : <Laptop className="size-3" />}
          {mode === "api" ? "API" : "Desktop"}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            paused
              ? "bg-muted text-muted-foreground"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${paused ? "bg-muted-foreground/60" : "bg-emerald-500"} ${isRunning ? "animate-pulse" : ""}`}
            aria-hidden
          />
          {paused ? "Paused" : "Active"}
        </span>
        <span className="ml-auto" />
        <Switch
          checked={!paused}
          onCheckedChange={onToggleActive}
          disabled={saving}
          aria-label="Active"
        />
        <button
          type="button"
          onClick={onCollapse}
          className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Hide sidebar"
          title="Hide sidebar"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {/* Status strip */}
      <div className="shrink-0 border-b border-sidebar-border px-4 py-3">
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Last run
            </div>
            <div className="mt-0.5 truncate text-xs text-foreground">
              {task.lastRunAt || task.lastAttemptAt ? (
                <>
                  {lastRunLabel}
                  {task.lastRunError && <span className="text-destructive"> · error</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Never</span>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Schedule
            </div>
            <div className="mt-0.5 truncate text-xs text-foreground">
              {summarizeSchedule(task.triggers)}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {scheduleOwnershipLabel(mode, task.triggers)}
            </div>
          </div>
        </div>
        {mode === "api" && task.triggers && (
          <CloudScheduleStatus
            state={scheduleState}
            error={scheduleError}
            onRetry={reloadScheduleState}
          />
        )}
        {mode === "api" && cloudRunStatus && (
          <div className="mt-3 rounded-none border border-sidebar-border bg-background/60 px-2.5 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className={`size-1.5 rounded-full ${cloudStatusDot(cloudRunStatus.status)}`} />
              <span className={`font-medium ${cloudStatusTone(cloudRunStatus.status)}`}>
                {cloudRunStatus.status}
              </span>
              {typeof cloudRunStatus.progressPercent === "number" && (
                <span className="text-muted-foreground">{cloudRunStatus.progressPercent}%</span>
              )}
              {cloudRunStatus.temporalStatus && (
                <span className="truncate text-muted-foreground">
                  {cloudRunStatus.temporalStatus}
                </span>
              )}
            </div>
            {cloudRunStatus.progressMessage && (
              <div
                className="mt-1 truncate text-[11px] text-muted-foreground"
                title={cloudRunStatus.progressMessage}
              >
                {cloudRunStatus.progressMessage}
              </div>
            )}
          </div>
        )}
        {mode === "api" &&
          artifactSync &&
          (() => {
            const present = artifactSyncPresentation(artifactSync.state);
            const syncing = artifactSync.state === "syncing" || pullingArtifact;
            return (
              <div className="mt-2 flex items-center gap-2 rounded-none border border-sidebar-border bg-background/60 px-2.5 py-1.5">
                {artifactSync.state === "current" ? (
                  <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
                ) : (
                  <span className={`size-1.5 shrink-0 rounded-full ${present.dot}`} />
                )}
                <span className={`text-[11px] font-medium ${present.tone}`}>{present.label}</span>
                <span className="ml-auto" />
                {present.canPull && onPullArtifact && (
                  <button
                    type="button"
                    onClick={onPullArtifact}
                    disabled={syncing}
                    className="inline-flex items-center gap-1 rounded-none border border-sidebar-border bg-background px-1.5 py-0.5 text-[10.5px] text-foreground hover:bg-accent disabled:opacity-50"
                    title="Pull the latest artifact from the cloud into index.md"
                  >
                    {syncing ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    Pull
                  </button>
                )}
              </div>
            );
          })()}
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 border-b border-sidebar-border px-4">
        <TabButton active={tab === "setup"} onClick={() => setTab("setup")}>
          Setup
        </TabButton>
        <TabButton active={tab === "runs"} onClick={() => setTab("runs")}>
          Runs history
        </TabButton>
      </div>

      {tab === "setup" && (
        <SetupTab
          draft={draft}
          setDraft={setDraft}
          editingInstructions={editingInstructions}
          setEditingInstructions={setEditingInstructions}
          onCancelInstructions={onCancelInstructions}
          onSave={onSave}
          saving={saving}
          dirty={dirty}
          showAdvanced={showAdvanced}
          setShowAdvanced={setShowAdvanced}
          confirmingDelete={confirmingDelete}
          setConfirmingDelete={setConfirmingDelete}
          onDelete={onDelete}
        />
      )}
      {tab === "runs" && <RunsHistoryTab slug={slug} task={task} />}

      {/* Footer — Edit with Copilot · Save (when dirty) · Run / Stop. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-sidebar-border bg-sidebar-accent/20 px-4 py-2.5">
        {isRunning ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-sidebar-foreground">
              <Loader2 className="size-3 animate-spin" />{" "}
              {mode === "api" ? "API worker" : "Running"}
            </span>
            <span className="ml-auto" />
            <Button variant="destructive" size="sm" onClick={onStop} disabled={saving}>
              <Square className="size-3" /> Stop
            </Button>
          </>
        ) : (
          <>
            {onEditWithCopilot && (
              <Button variant="ghost" size="sm" onClick={onEditWithCopilot} disabled={saving}>
                <Sparkles className="size-3" /> Edit with Copilot
              </Button>
            )}
            {dirty && !editingInstructions && tab === "setup" && (
              <Button variant="outline" size="sm" onClick={onSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}{" "}
                Save
              </Button>
            )}
            <span className="ml-auto" />
            <Button size="sm" onClick={onRunNow} disabled={saving}>
              <Play className="size-3" /> Run now
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Detail view — 2-pane layout
// ---------------------------------------------------------------------------

function TaskDetail({
  slug,
  onBack,
  onDeleted,
  onEditWithCopilot,
}: {
  slug: string;
  onBack: () => void;
  onDeleted: () => void;
  onEditWithCopilot?: (slug: string) => void;
}) {
  const [task, setTask] = useState<BackgroundTask | null>(null);
  const [draft, setDraft] = useState<BackgroundTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [outputRefreshKey, setOutputRefreshKey] = useState(0);
  const [cloudRunId, setCloudRunId] = useState<string | null>(null);
  const [cloudRunStatus, setCloudRunStatus] = useState<BackgroundTaskCloudRunStatusType | null>(
    null,
  );
  const [artifactSync, setArtifactSync] = useState<BackgroundTaskArtifactSyncType | null>(null);
  const [pullingArtifact, setPullingArtifact] = useState(false);
  const sidebarInitialized = useRef(false);

  const agentStatus = useBackgroundTaskAgentStatus();
  const liveStatus = agentStatus.get(slug);
  const isApiTask = task ? executionTargetOf(task) === "api" : false;
  // Bus events are the only source of truth for "is this task currently
  // running" — see RunsHistoryTab for the rationale.
  const isCloudRunning =
    isApiTask && cloudRunStatus ? !isTerminalCloudStatus(cloudRunStatus.status) : false;
  const isRunning = isApiTask ? isCloudRunning : liveStatus?.status === "running";
  const paused = task ? !task.active : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.ipc.invoke("bg-task:get", { slug });
      if (result.success && result.task) {
        setTask(result.task);
        setDraft(result.task);
        // On first open, collapse the details sidebar when the agent already
        // has output so the user can read it without extra chrome.
        if (!sidebarInitialized.current) {
          sidebarInitialized.current = true;
          try {
            const out = await window.ipc.invoke("workspace:readFile", {
              path: `bg-tasks/${slug}/index.md`,
            });
            const body = (out.data ?? "").trim();
            if (body && body !== `# ${result.task.name}`) {
              setSidebarOpen(false);
            }
          } catch {
            // No output file yet — keep the sidebar open.
          }
        }
        if (executionTargetOf(result.task) === "api" && result.task.lastRunId && !cloudRunId) {
          setCloudRunId(result.task.lastRunId);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [slug, cloudRunId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch when the agent completes a run — fresh flat fields, fresh index.md.
  useEffect(() => {
    if (liveStatus?.status === "done" || liveStatus?.status === "error") {
      void load();
      setOutputRefreshKey((k) => k + 1);
    }
  }, [liveStatus?.status, load]);

  useEffect(() => {
    setCloudRunId(null);
    setCloudRunStatus(null);
    setArtifactSync(null);
    sidebarInitialized.current = false;
  }, [slug]);

  const loadArtifactSync = useCallback(async () => {
    if (!isApiTask) return;
    try {
      const result = await window.ipc.invoke("bg-task:getArtifactSyncState", {
        slug,
      });
      if (result.success && result.sync) setArtifactSync(result.sync);
    } catch {
      // Sync state is advisory; ignore transient fetch failures.
    }
  }, [isApiTask, slug]);

  useEffect(() => {
    void loadArtifactSync();
  }, [loadArtifactSync]);

  const pullArtifact = useCallback(async () => {
    setPullingArtifact(true);
    setArtifactSync((s: BackgroundTaskArtifactSyncType | null) =>
      s ? { ...s, state: "syncing" } : s,
    );
    try {
      const result = await window.ipc.invoke("bg-task:pullCloudArtifact", {
        slug,
      });
      if (result.success) {
        setOutputRefreshKey((k) => k + 1);
      } else {
        toast(result.error ?? "Could not pull artifact", "error");
      }
    } finally {
      setPullingArtifact(false);
      void loadArtifactSync();
    }
  }, [slug, loadArtifactSync]);

  useEffect(() => {
    if (!isApiTask || !cloudRunId) return;
    let cancelled = false;
    let interval: number | undefined;

    const poll = async () => {
      const result = await window.ipc.invoke("bg-task:getCloudRunStatus", {
        slug,
        runId: cloudRunId,
      });
      if (cancelled) return;
      if (result.success && result.status) {
        setCloudRunStatus(result.status);
        if (isTerminalCloudStatus(result.status.status)) {
          if (result.status.status === "succeeded") {
            // Only overwrite the local index.md when the remote artifact is
            // actually ahead, mirroring the offline-return auto-pull guard. // ... (ERRORS.md E39)
            const sync = await window.ipc.invoke("bg-task:getArtifactSyncState", { slug });
            const syncState = sync.success ? sync.sync?.state : undefined;
            if (!cancelled && (syncState === "remote_newer" || syncState === "not_pulled")) {
              const pulled = await window.ipc.invoke("bg-task:pullCloudArtifact", { slug });
              if (!cancelled && pulled.success) {
                setOutputRefreshKey((k) => k + 1);
              }
            }
          }
          if (!cancelled) void loadArtifactSync();
          if (interval) window.clearInterval(interval);
          void load();
        }
      }
    };

    void poll();
    interval = window.setInterval(() => {
      void poll();
    }, 2_000);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [cloudRunId, isApiTask, load, slug, loadArtifactSync]);

  const isDirty = useMemo(() => {
    if (!task || !draft) return false;
    return JSON.stringify(task) !== JSON.stringify(draft);
  }, [task, draft]);

  const save = async () => {
    if (!draft || !task) return;
    setSaving(true);
    try {
      const partial: Partial<BackgroundTask> = {};
      if (draft.instructions !== task.instructions) partial.instructions = draft.instructions;
      if (JSON.stringify(draft.triggers) !== JSON.stringify(task.triggers))
        partial.triggers = draft.triggers;
      if (draft.model !== task.model) partial.model = draft.model;
      if (draft.provider !== task.provider) partial.provider = draft.provider;
      if (executionTargetOf(draft) !== executionTargetOf(task))
        partial.executionTarget = executionTargetOf(draft);
      const result = await window.ipc.invoke("bg-task:patch", {
        slug,
        partial,
      });
      if (result.success && result.task) {
        setTask(result.task);
        setDraft(result.task);
        setEditingInstructions(false);
      } else {
        toast(result.error ?? "Failed to save", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelInstructions = () => {
    if (!task) return;
    setDraft((d) => (d ? { ...d, instructions: task.instructions } : d));
    setEditingInstructions(false);
  };

  const toggleActive = async (active: boolean) => {
    if (!task) return;
    const result = await window.ipc.invoke("bg-task:patch", {
      slug,
      partial: { active },
    });
    if (result.success && result.task) {
      setTask(result.task);
      setDraft(result.task);
    }
  };

  const runNow = async () => {
    if (task && executionTargetOf(task) === "api") {
      const result = await window.ipc.invoke("bg-task:triggerCloudRun", {
        slug,
        trigger: "manual",
      });
      if (result.success && result.run) {
        setCloudRunId(result.run.runId);
        setCloudRunStatus(cloudRunStatusFromRun(result.run));
      } else {
        toast(result.error ?? "Run failed", "error");
      }
      return;
    }
    const result = await window.ipc.invoke("bg-task:run", { slug });
    if (!result.success) {
      toast(result.error ?? "Run failed", "error");
    }
  };

  const stopRun = async () => {
    if (task && executionTargetOf(task) === "api") {
      if (!cloudRunId) {
        toast("No active API-worker run for this task", "error");
        return;
      }
      const result = await window.ipc.invoke("bg-task:cancelCloudRun", {
        slug,
        runId: cloudRunId,
      });
      if (result.success && result.run) {
        setCloudRunStatus(cloudRunStatusFromRun(result.run));
      } else if (!result.success) {
        toast(result.error ?? "Stop failed", "error");
      }
      return;
    }
    const result = await window.ipc.invoke("bg-task:stop", { slug });
    if (!result.success) {
      toast(result.error ?? "Stop failed", "error"); // ... (ERRORS.md E34)
    }
  };

  const deleteTask = async () => {
    const result = await window.ipc.invoke("bg-task:delete", { slug });
    if (result.success) {
      onDeleted();
    } else {
      toast(result.error ?? "Delete failed", "error");
    }
  };

  if (loading || !task || !draft) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar — back to list, sidebar toggle when collapsed */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back to background tasks"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="truncate text-sm font-medium text-muted-foreground">Background tasks</span>
        <span className="ml-auto" />
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-none border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent hover:text-foreground"
            aria-label="Show sidebar"
          >
            <PanelRightOpen className="size-3.5" />
            <span>Show details</span>
          </button>
        )}
      </div>

      {/* Body: main (output) + right sidebar */}
      <div className="flex flex-1 min-h-0">
        <OutputPane slug={slug} taskName={task.name} refreshKey={outputRefreshKey} />
        {sidebarOpen && (
          <ControlSidebar
            slug={slug}
            task={task}
            draft={draft}
            setDraft={setDraft}
            isRunning={isRunning}
            paused={paused}
            saving={saving}
            dirty={isDirty}
            editingInstructions={editingInstructions}
            setEditingInstructions={setEditingInstructions}
            onCancelInstructions={cancelInstructions}
            onSave={save}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            confirmingDelete={confirmingDelete}
            setConfirmingDelete={setConfirmingDelete}
            onToggleActive={toggleActive}
            onRunNow={runNow}
            onStop={stopRun}
            onDelete={deleteTask}
            onCollapse={() => setSidebarOpen(false)}
            onEditWithCopilot={onEditWithCopilot ? () => onEditWithCopilot(slug) : undefined}
            cloudRunStatus={cloudRunStatus}
            artifactSync={artifactSync}
            onPullArtifact={pullArtifact}
            pullingArtifact={pullingArtifact}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

export interface BgTasksViewProps {
  /**
   * Optional Copilot hand-off. When provided, the "New task" dialog opens
   * in free-form "describe" mode and the user can punt to Copilot with a
   * single-sentence description. Hosted in App.tsx so it routes through
   * the same chat-submit pipeline as the rest of the app.
   */
  onCreateWithCopilot?: (description: string) => void;
  /**
   * Optional Copilot hand-off for editing an existing task. Wired to the
   * "Edit with Copilot" button in the detail-view sidebar footer.
   */
  onEditWithCopilot?: (slug: string) => void;
  /**
   * If provided, the view opens with this task already selected. Updates to
   * this prop sync into internal state so the sidebar can swap which task is
   * focused without remounting the view.
   */
  initialSlug?: string | null;
  /**
   * Bump this counter to force a re-focus on `initialSlug` even when the
   * slug value itself didn't change (e.g. user clicks the same task in the
   * sidebar twice after navigating away inside the view).
   */
  slugVersion?: number;
}

function formatLastRanLabel(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return formatRelativeTime(iso) || "Never";
}

// ---------------------------------------------------------------------------
// Global Cloud Runs view — every API-worker run across all tasks, filterable.
// ---------------------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-none border px-2 py-0.5 text-[11px] transition-colors ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const CLOUD_STATUS_FILTERS: {
  value: BackgroundTaskRunStatusType | "all";
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "stopped", label: "Stopped" },
];

const CLOUD_TRIGGER_FILTERS: {
  value: BackgroundTaskTriggerType | "all";
  label: string;
}[] = [
  { value: "all", label: "Any trigger" },
  { value: "manual", label: "Manual" },
  { value: "cron", label: "Cron" },
  { value: "window", label: "Window" },
  { value: "event", label: "Event" },
  { value: "retry", label: "Retry" },
];

function GlobalCloudRunsView({
  taskNameBySlug,
  onOpenTask,
  onShowTasks,
}: {
  taskNameBySlug: Map<string, string>;
  onOpenTask: (slug: string) => void;
  onShowTasks: () => void;
}) {
  const [rows, setRows] = useState<BackgroundTaskCloudRunType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BackgroundTaskRunStatusType | "all">("all");
  const [triggerFilter, setTriggerFilter] = useState<BackgroundTaskTriggerType | "all">("all");
  const [slugFilter, setSlugFilter] = useState<string>("all");
  const [sinceFilter, setSinceFilter] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [selected, setSelected] = useState<{
    slug: string;
    runId: string;
  } | null>(null);

  const load = useCallback(async (
    cursor?: string,
    mode: "replace" | "append" | "refresh" = "replace",
  ) => {
    if (mode === "append") {
      setLoadingMore(true);
    } else if (mode === "replace") {
      setLoading(true);
    }
    try {
      const sinceMs =
        sinceFilter === "24h"
          ? 24 * 3600_000
          : sinceFilter === "7d"
            ? 7 * 24 * 3600_000
            : sinceFilter === "30d"
              ? 30 * 24 * 3600_000
              : null;
      const result = await window.ipc.invoke("bg-task:listAllCloudRuns", {
        executor: "api",
        limit: 200,
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(triggerFilter !== "all" ? { trigger: triggerFilter } : {}),
        ...(slugFilter !== "all" ? { slug: slugFilter } : {}),
        ...(sinceMs ? { since: new Date(Date.now() - sinceMs).toISOString() } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (result.success) {
        setRows((current) => {
          if (mode === "replace") return result.runs;
          const ordered = mode === "append" ? [...current, ...result.runs] : [...result.runs, ...current];
          return [...new Map(ordered.map((run) => [`${run.slug}:${run.runId}`, run])).values()];
        });
        if (mode !== "refresh") {
          setNextCursor(result.nextCursor ?? null);
        }
        setError(null);
      } else {
        setError(result.error ?? "Could not load cloud runs.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cloud runs.");
    } finally {
      if (mode === "append") {
        setLoadingMore(false);
      } else if (mode === "replace") {
        setLoading(false);
      }
    }
  }, [statusFilter, triggerFilter, slugFilter, sinceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh while any listed run is still in flight.
  useEffect(() => {
    if (!rows.some((r) => !isTerminalCloudStatus(r.status))) return;
    const interval = window.setInterval(() => {
      void load(undefined, "refresh");
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [load, rows]);

  if (selected) {
    return (
      <CloudRunTranscriptView
        slug={selected.slug}
        runId={selected.runId}
        onBack={() => {
          setSelected(null);
          void load();
        }}
        onSelectRun={(runId) => setSelected((s) => (s ? { ...s, runId } : s))}
        onChanged={load}
      />
    );
  }

  const hasActiveFilters =
    statusFilter !== "all" ||
    triggerFilter !== "all" ||
    slugFilter !== "all" ||
    sinceFilter !== "all";

  const clearFilters = () => {
    setStatusFilter("all");
    setTriggerFilter("all");
    setSlugFilter("all");
    setSinceFilter("all");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {rows.length > 0 || hasActiveFilters ? (
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-6 py-2.5">
        {CLOUD_STATUS_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={statusFilter === f.value}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {CLOUD_TRIGGER_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={triggerFilter === f.value}
            onClick={() => setTriggerFilter(f.value)}
          >
            {f.label}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {(["all", "24h", "7d", "30d"] as const).map((value) => (
          <FilterChip
            key={value}
            active={sinceFilter === value}
            onClick={() => setSinceFilter(value)}
          >
            {value === "all" ? "Any time" : value}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Select
          value={slugFilter}
          onValueChange={setSlugFilter}
        >
          <SelectTrigger
            size="sm"
            className="h-6 max-w-[180px] rounded-[2px] text-[11px]"
            aria-label="Filter by task"
          >
            <SelectValue placeholder="All tasks" />
          </SelectTrigger>
          <SelectContent className="app-shell rounded-[2px]">
            <SelectItem value="all">All tasks</SelectItem>
            {[...taskNameBySlug.entries()].map(([slug, name]) => (
              <SelectItem key={slug} value={slug}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void load(undefined, "replace")}
          className="h-6 gap-1 rounded-[2px] px-2 text-[11px] text-muted-foreground"
          title="Refresh"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
          Refresh
        </Button>
      </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-6 py-6 text-sm text-destructive">{error}</div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Cloud className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {hasActiveFilters
                ? "No cloud runs match these filters"
                : taskNameBySlug.size === 0
                  ? "No background tasks yet"
                  : "No cloud runs yet"}
            </p>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">
              {hasActiveFilters
                ? "Clear the filters to see every run."
                : taskNameBySlug.size === 0
                  ? "Create a task first; its cloud execution history will appear here."
                  : "Run a task in the cloud and its status, timeline, and output will appear here."}
            </p>
            <Button size="sm" variant="outline" onClick={hasActiveFilters ? clearFilters : onShowTasks}>
              {hasActiveFilters ? "Clear filters" : "Open tasks"}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((row) => (
              <div
                key={`${row.slug}:${row.runId}`}
                className="flex items-center gap-3 px-6 py-2.5 transition-colors hover:bg-muted/20"
              >
                <div className={`size-1.5 shrink-0 rounded-full ${cloudStatusDot(row.status)}`} />
                <button
                  type="button"
                  onClick={() => setSelected({ slug: row.slug, runId: row.runId })}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="truncate font-medium text-foreground">
                      {taskNameBySlug.get(row.slug) ?? row.slug}
                    </span>
                    <span className={`text-[11px] ${cloudStatusTone(row.status)}`}>
                      {row.status}
                    </span>
                    {row.trigger && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {row.trigger}
                      </span>
                    )}
                    {typeof row.attempt === "number" && row.attempt > 1 && (
                      <span className="text-[10.5px] text-muted-foreground">
                        attempt {row.attempt}
                      </span>
                    )}
                    {typeof row.progressPercent === "number" &&
                      !isTerminalCloudStatus(row.status) && (
                        <span className="text-[10.5px] text-muted-foreground">
                          {row.progressPercent}%
                        </span>
                      )}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                    <span className="truncate">{row.runId}</span>
                    {row.createdAt && (
                      <>
                        <span>·</span>
                        <span className="shrink-0">{formatRunAt(row.createdAt)}</span>
                      </>
                    )}
                  </div>
                  {(row.errorDetails || row.error || row.progressMessage || row.summary) && (
                    <div
                      className={`truncate text-[11px] ${row.error || row.errorCode ? "text-destructive" : "text-foreground/70"}`}
                    >
                      {row.errorCode ? `[${row.errorCode}] ` : ""}
                      {row.errorDetails ?? row.error ?? row.progressMessage ?? row.summary}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenTask(row.slug)}
                  className="hidden shrink-0 rounded-none border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-flex"
                  title="Open task"
                >
                  Open task
                </button>
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              </div>
            ))}
            {nextCursor ? (
              <div className="flex justify-center px-6 py-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void load(nextCursor, "append")}
                >
                  {loadingMore ? <Loader2 className="size-3 animate-spin" /> : null}
                  Load more runs
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function BgTasksView({
  onCreateWithCopilot,
  onEditWithCopilot,
  initialSlug,
  slugVersion,
}: BgTasksViewProps = {}) {
  const [items, setItems] = useState<BackgroundTaskSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug ?? null);
  useEffect(() => {
    setSelectedSlug(initialSlug ?? null);
  }, [initialSlug, slugVersion]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  // Per-row spinners while the corresponding IPC is in flight — same pattern
  // as `LiveNotesView` uses for its toggle / stop buttons.
  const [updatingSlugs, setUpdatingSlugs] = useState<Set<string>>(new Set());
  const [stoppingSlugs, setStoppingSlugs] = useState<Set<string>>(new Set());
  const [listMode, setListMode] = useState<"tasks" | "runs">("tasks");
  const agentStatus = useBackgroundTaskAgentStatus();
  const taskNameBySlug = useMemo(() => new Map(items.map((t) => [t.slug, t.name])), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.ipc.invoke("bg-task:list", { limit: 200 });
      setItems(result.items);
      setError(null);
    } catch (err) {
      console.error("Failed to load background tasks:", err);
      setError("Could not load background tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (agentStatus.size > 0) {
      void load();
    }
  }, [agentStatus, load]);

  const handleToggleActive = useCallback(async (slug: string, active: boolean) => {
    setUpdatingSlugs((prev) => new Set(prev).add(slug));
    try {
      const result = await window.ipc.invoke("bg-task:patch", {
        slug,
        partial: { active },
      });
      if (!result.success) {
        toast(result.error ?? "Failed to update task", "error");
        return;
      }
      // Optimistically reflect the new state without re-fetching the whole list.
      setItems((prev) => prev.map((t) => (t.slug === slug ? { ...t, active } : t)));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update task", "error");
    } finally {
      setUpdatingSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    }
  }, []);

  const handleStop = useCallback(async (slug: string) => {
    setStoppingSlugs((prev) => new Set(prev).add(slug));
    try {
      const result = await window.ipc.invoke("bg-task:stop", { slug });
      if (!result.success && result.error) {
        toast(result.error, "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to stop run", "error");
    } finally {
      setStoppingSlugs((prev) => {
        const next = new Set(prev);
        next.delete(slug);
        return next;
      });
    }
  }, []);

  if (selectedSlug) {
    return (
      <TaskDetail
        slug={selectedSlug}
        onBack={() => {
          setSelectedSlug(null);
          void load();
        }}
        onDeleted={() => {
          setSelectedSlug(null);
          void load();
        }}
        onEditWithCopilot={onEditWithCopilot}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ListChecks className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Background tasks</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-none border border-border">
              <button
                type="button"
                onClick={() => setListMode("tasks")}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  listMode === "tasks"
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                Tasks
              </button>
              <button
                type="button"
                onClick={() => setListMode("runs")}
                className={`inline-flex items-center gap-1 border-l border-border px-2.5 py-1 text-xs transition-colors ${
                  listMode === "runs"
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Cloud className="size-3" /> Cloud runs
              </button>
            </div>
            {listMode === "tasks" && !loading && items.length > 0 && (
              <Button size="sm" onClick={() => setShowNewDialog(true)}>
                New task
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {listMode === "tasks"
            ? "Persistent tasks that fire on a schedule or in response to events. Toggle a task inactive to pause it."
            : "Every API-worker run across all tasks. Click a run to inspect its timeline; filter by status and trigger."}
        </p>
      </div>
      {listMode === "runs" ? (
        <GlobalCloudRunsView
          taskNameBySlug={taskNameBySlug}
          onOpenTask={setSelectedSlug}
          onShowTasks={() => setListMode("tasks")}
        />
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <div className="rounded-full bg-muted p-3">
                <ListChecks className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <div className="rounded-full bg-muted p-3">
                <ListChecks className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Give recurring work a reliable owner</p>
              <p className="max-w-md text-xs leading-5 text-muted-foreground">
                Background tasks can watch for changes, prepare drafts, and surface exceptions. External actions still follow your approval policy.
              </p>
              <Button size="sm" onClick={() => setShowNewDialog(true)}>
                <Plus className="size-3" /> Create your first task
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-none border border-border/60 bg-card">
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-[45%]" />
                  <col className="w-[17%]" />
                  <col className="w-[13%]" />
                  <col className="w-[25%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-left">
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Task
                    </th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Schedule
                    </th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Last ran
                    </th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      State
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((task) => {
                    const live = agentStatus.get(task.slug);
                    const mode = executionTargetOf(task);
                    const isRunning = live?.status === "running";
                    const isUpdating = updatingSlugs.has(task.slug);
                    const isStopping = stoppingSlugs.has(task.slug);
                    const hasError = !isRunning && !!task.lastRunError;
                    const instructionsPreview = task.instructions.split("\n")[0].trim();
                    return (
                      <tr
                        key={task.slug}
                        className={`border-b border-border/50 last:border-b-0 transition-colors ${isRunning ? "bg-primary/5" : "hover:bg-muted/20"}`}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              {hasError && (
                                <AlertCircle
                                  className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                                  aria-label="Last run failed"
                                >
                                  <title>Last run failed: {task.lastRunError}</title>
                                </AlertCircle>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelectedSlug(task.slug)}
                                className="truncate text-left text-sm font-medium text-foreground hover:text-primary"
                                title={task.name}
                              >
                                {task.name}
                              </button>
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              <span>{task.slug}</span>
                              <span className="ml-2 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">
                                {mode === "api" ? (
                                  <Cloud className="size-3" />
                                ) : (
                                  <Laptop className="size-3" />
                                )}
                                {mode === "api" ? "API" : "Desktop"}
                              </span>
                            </div>
                            {instructionsPreview && (
                              <div
                                className="truncate text-xs text-muted-foreground/80"
                                title={task.instructions}
                              >
                                {instructionsPreview}
                              </div>
                            )}
                            {hasError && task.lastRunError && (
                              <div
                                className="truncate text-xs text-amber-600 dark:text-amber-400"
                                title={task.lastRunError}
                              >
                                {task.lastRunError}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/80">
                          <div>{summarizeSchedule(task.triggers)}</div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {scheduleOwnershipLabel(mode, task.triggers)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground/80">
                          {formatLastRanLabel(task.lastRunAt)}
                        </td>
                        <td className="px-4 py-3">
                          {isRunning ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1.5 rounded-none bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground animate-pulse">
                                <Loader2 className="size-3 animate-spin" />
                                Updating…
                              </span>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleStop(task.slug)}
                                disabled={isStopping}
                              >
                                {isStopping ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Square className="size-3" />
                                )}
                                Stop
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              {isUpdating ? (
                                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                              ) : (
                                <span className="size-4 shrink-0" aria-hidden="true" />
                              )}
                              <Switch
                                checked={task.active}
                                onCheckedChange={(checked) => {
                                  void handleToggleActive(task.slug, checked);
                                }}
                                disabled={isUpdating}
                              />
                              <span className="min-w-16 text-xs font-medium text-foreground/80">
                                {task.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <NewTaskDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={(slug, executionTarget) => {
          setShowNewDialog(false);
          void load();
          setSelectedSlug(slug);
          // Await the first run so a failed kick-off (e.g. an API task while
          // signed out) surfaces feedback instead of silently no-op'ing. // ... (ERRORS.md E33)
          void (async () => {
            const result =
              executionTarget === "api"
                ? await window.ipc.invoke("bg-task:triggerCloudRun", {
                    slug,
                    trigger: "manual",
                  })
                : await window.ipc.invoke("bg-task:run", { slug });
            if (!result.success) {
              toast(result.error ?? "Run failed", "error");
            }
          })();
        }}
        onCreateWithCopilot={onCreateWithCopilot}
      />
    </div>
  );
}
