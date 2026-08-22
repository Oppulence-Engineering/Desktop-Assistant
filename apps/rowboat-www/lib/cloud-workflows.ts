"use client";

import "client-only";

import { z } from "zod";

import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";

export const CloudTaskSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  instructions: z.string(),
  active: z.boolean(),
  triggers: z.unknown().optional(),
  model: z.string().optional().default(""),
  provider: z.string().optional().default(""),
  executionTarget: z.enum(["api", "desktop"]),
  templateSlug: z.string().optional().default(""),
  templateVersion: z.number().int().optional().default(0),
  systemManaged: z.boolean().optional().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastAttemptAt: z.string().nullable().optional(),
  lastRunId: z.string().optional().default(""),
  lastRunAt: z.string().nullable().optional(),
  lastRunSummary: z.string().optional().default(""),
  lastRunError: z.string().optional().default(""),
  scheduleSyncState: z.enum(["current", "syncing", "failed", "paused"]),
  scheduleSyncError: z.string().optional().default(""),
  scheduleSyncedAt: z.string().nullable().optional(),
  revision: z.number().int(),
});

export type CloudTask = z.infer<typeof CloudTaskSchema>;

export const CloudTaskTemplateSchema = z.object({
  slug: z.string(),
  taskSlug: z.string(),
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
  active: z.boolean(),
  triggers: z.unknown().optional(),
  model: z.string().optional().default(""),
  provider: z.string().optional().default(""),
  executionTarget: z.enum(["api", "desktop"]),
  tags: z.array(z.string()).optional().default([]),
  requiredConnectors: z.array(z.string()).optional().default([]),
  version: z.number().int().optional().default(1),
  firstParty: z.boolean().optional().default(false),
});

export type CloudTaskTemplate = z.infer<typeof CloudTaskTemplateSchema>;

export const CloudRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "stopped"]);
export const CloudRunTriggerSchema = z.enum(["manual", "cron", "window", "event", "retry"]);

export const CloudRunSchema = z.object({
  id: z.string(),
  runId: z.string(),
  previousRunId: z.string().optional().default(""),
  retryOfRunId: z.string().optional().default(""),
  slug: z.string(),
  trigger: CloudRunTriggerSchema,
  status: CloudRunStatusSchema,
  executor: z.enum(["api", "desktop"]),
  attempt: z.number().int(),
  requestedContext: z.string().optional().default(""),
  summary: z.string().optional().default(""),
  error: z.string().optional().default(""),
  errorCode: z.string().optional().default(""),
  errorDetails: z.string().optional().default(""),
  temporalWorkflowId: z.string().optional().default(""),
  progressPercent: z.number().int().nullable().optional(),
  progressMessage: z.string().optional().default(""),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int(),
});

export type CloudRun = z.infer<typeof CloudRunSchema>;
export type CloudRunStatus = z.infer<typeof CloudRunStatusSchema>;
export type CloudRunTrigger = z.infer<typeof CloudRunTriggerSchema>;

export const CloudRunEventSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  type: z.string().optional().default("event"),
  event: z.unknown(),
  receivedAt: z.string(),
});

export type CloudRunEvent = z.infer<typeof CloudRunEventSchema>;

const NullableString = z.string().nullable().optional();
const ScheduleSourceSchema = z.object({
  mechanism: z.string(),
  health: z.string(),
  nextDueAt: NullableString,
  lastEvaluatedAt: NullableString,
  lastTriggeredAt: NullableString,
});

export const CloudScheduleSchema = z.object({
  target: z.string(),
  triggerSources: z.array(z.string()),
  health: z.string(),
  mechanism: z.string(),
  nextDueAt: NullableString,
  lastEvaluatedAt: NullableString,
  lastTriggeredAt: NullableString,
  scheduleSyncState: z.string().optional().default(""),
  sources: z.record(z.string(), ScheduleSourceSchema).optional().default({}),
});

export type CloudSchedule = z.infer<typeof CloudScheduleSchema>;

const TaskListSchema = z.object({ tasks: z.array(CloudTaskSchema) });
const TemplateListSchema = z.object({ templates: z.array(CloudTaskTemplateSchema) });
const RunListSchema = z.object({
  runs: z.array(CloudRunSchema),
  nextCursor: z.string().optional(),
});
const EventListSchema = z.object({ events: z.array(CloudRunEventSchema) });

async function workflowRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await dashboardFetch(toDashboardAPIPath(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : `Workflow request failed (${response.status})`;
    throw new Error(message);
  }
  return schema.parse(body);
}

export async function ensureFirstPartyWorkflows(): Promise<CloudTask[]> {
  return (
    await workflowRequest("/background-tasks/first-party/ensure", TaskListSchema, {
      method: "POST",
    })
  ).tasks;
}

export async function listCloudTasks(): Promise<CloudTask[]> {
  return (await workflowRequest("/background-tasks", TaskListSchema)).tasks;
}

export async function listCloudTemplates(): Promise<CloudTaskTemplate[]> {
  return (await workflowRequest("/background-task-templates", TemplateListSchema)).templates;
}

export async function createCloudTask(input: {
  slug?: string;
  name: string;
  instructions: string;
  active: boolean;
  cronExpr?: string;
}): Promise<CloudTask> {
  const triggers = input.cronExpr
    ? {
        cronExpr: input.cronExpr,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      }
    : { manual: true };
  return workflowRequest("/background-tasks", CloudTaskSchema, {
    method: "POST",
    body: JSON.stringify({ ...input, triggers, executionTarget: "api" }),
  });
}

export async function instantiateCloudTemplate(templateSlug: string): Promise<CloudTask> {
  return workflowRequest(
    `/background-task-templates/${encodeURIComponent(templateSlug)}/instantiate`,
    CloudTaskSchema,
    { method: "POST", body: "{}" },
  );
}

export async function updateCloudTask(
  task: CloudTask,
  patch: { active?: boolean; cronExpr?: string; instructions?: string },
): Promise<CloudTask> {
  const payload: Record<string, unknown> = { revision: task.revision };
  if (patch.active !== undefined) payload.active = patch.active;
  if (patch.instructions !== undefined) payload.instructions = patch.instructions;
  if (patch.cronExpr !== undefined) {
    const current: Record<string, unknown> =
      task.triggers && typeof task.triggers === "object" ? { ...task.triggers } : {};
    const cronExpr = patch.cronExpr.trim();
    if (cronExpr) {
      payload.triggers = {
        ...current,
        cronExpr,
        timezone:
          "timezone" in current && typeof current.timezone === "string"
            ? current.timezone
            : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      };
    } else {
      const remaining = { ...current };
      delete remaining.cronExpr;
      delete remaining.timezone;
      payload.triggers = Object.keys(remaining).length > 0 ? remaining : { manual: true };
    }
  }
  return workflowRequest(`/background-tasks/${encodeURIComponent(task.slug)}`, CloudTaskSchema, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type RunFilters = {
  status?: CloudRunStatus | "all";
  trigger?: CloudRunTrigger | "all";
  executor?: "api" | "desktop" | "all";
  slug?: string;
  cursor?: string;
};

export async function listCloudRuns(
  filters: RunFilters = {},
): Promise<{ runs: CloudRun[]; nextCursor?: string }> {
  const params = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all") params.set(key, value);
  }
  return workflowRequest(`/background-task-runs?${params}`, RunListSchema);
}

export async function getCloudSchedule(slug: string): Promise<CloudSchedule> {
  return workflowRequest(
    `/background-tasks/${encodeURIComponent(slug)}/schedule-state`,
    CloudScheduleSchema,
  );
}

export async function getCloudRun(slug: string, runId: string): Promise<CloudRun> {
  return workflowRequest(
    `/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    CloudRunSchema,
  );
}

export async function triggerCloudRun(slug: string, context = ""): Promise<CloudRun> {
  return workflowRequest(`/background-tasks/${encodeURIComponent(slug)}/trigger`, CloudRunSchema, {
    method: "POST",
    body: JSON.stringify({ trigger: "manual", context }),
  });
}

export async function cancelCloudRun(run: CloudRun): Promise<CloudRun> {
  return workflowRequest(
    `/background-tasks/${encodeURIComponent(run.slug)}/runs/${encodeURIComponent(run.runId)}/cancel`,
    CloudRunSchema,
    { method: "POST", body: "{}" },
  );
}

export async function retryCloudRun(run: CloudRun): Promise<CloudRun> {
  return workflowRequest(
    `/background-tasks/${encodeURIComponent(run.slug)}/runs/${encodeURIComponent(run.runId)}/retry`,
    CloudRunSchema,
    { method: "POST", body: "{}" },
  );
}

export async function listCloudRunEvents(slug: string, runId: string): Promise<CloudRunEvent[]> {
  return (
    await workflowRequest(
      `/background-tasks/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/events`,
      EventListSchema,
    )
  ).events;
}

export function taskCron(task: CloudTask): string {
  if (!task.triggers || typeof task.triggers !== "object" || !("cronExpr" in task.triggers))
    return "";
  return typeof task.triggers.cronExpr === "string" ? task.triggers.cronExpr : "";
}
