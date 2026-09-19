import { z } from "zod";

import { isOptionalRequestFailure, requestJson, type RequestJsonFn } from "@/lib/api/request-json";

const CloudTaskSchema = z.object({
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

const CloudTaskTemplateSchema = z.object({
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

const CloudRunSchema = z.object({
  id: z.string(),
  runId: z.string(),
  previousRunId: z.string().optional().default(""),
  retryOfRunId: z.string().optional().default(""),
  slug: z.string(),
  trigger: z.enum(["manual", "cron", "window", "event", "retry"]),
  status: z.enum(["queued", "running", "succeeded", "failed", "stopped"]),
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

const TaskListSchema = z.object({ tasks: z.array(CloudTaskSchema) });
const TemplateListSchema = z.object({ templates: z.array(CloudTaskTemplateSchema) });
const RunListSchema = z.object({
  runs: z.array(CloudRunSchema),
  nextCursor: z.string().optional(),
});

export type WorkflowTask = z.infer<typeof CloudTaskSchema>;
export type WorkflowTemplate = z.infer<typeof CloudTaskTemplateSchema>;
export type WorkflowRun = z.infer<typeof CloudRunSchema>;
export type WorkflowRunPage = { runs: WorkflowRun[]; nextCursor?: string };

export type WorkflowRunFilters = {
  status?: string;
  trigger?: string;
  executor?: string;
  slug?: string;
  cursor?: string;
};

function runsPath(filters: WorkflowRunFilters = {}): string {
  const params = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all") params.set(key, value);
  }
  return `/background-task-runs?${params.toString()}`;
}

export async function loadWorkflowTasks(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<WorkflowTask[]> {
  try {
    return (await request({ path: "/background-tasks", schema: TaskListSchema, signal })).tasks;
  } catch (error) {
    if (isOptionalRequestFailure(error)) return [];
    throw error;
  }
}

export async function loadWorkflowTemplates(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<WorkflowTemplate[]> {
  try {
    return (
      await request({ path: "/background-task-templates", schema: TemplateListSchema, signal })
    ).templates;
  } catch (error) {
    if (isOptionalRequestFailure(error)) return [];
    throw error;
  }
}

export async function loadWorkflowRuns(
  request: RequestJsonFn,
  filters: WorkflowRunFilters = {},
  signal?: AbortSignal,
): Promise<WorkflowRunPage> {
  try {
    return await request({
      path: runsPath(filters),
      schema: RunListSchema,
      signal,
    });
  } catch (error) {
    if (isOptionalRequestFailure(error)) return { runs: [] };
    throw error;
  }
}

export function fetchWorkflowTasks(signal?: AbortSignal): Promise<WorkflowTask[]> {
  return loadWorkflowTasks(requestJson, signal);
}

export function fetchWorkflowTemplates(signal?: AbortSignal): Promise<WorkflowTemplate[]> {
  return loadWorkflowTemplates(requestJson, signal);
}

export function fetchWorkflowRuns(
  filters: WorkflowRunFilters = {},
  signal?: AbortSignal,
): Promise<WorkflowRunPage> {
  return loadWorkflowRuns(requestJson, filters, signal);
}

export async function loadRelationshipRefreshBlocker(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<string> {
  const { runs } = await loadWorkflowRuns(
    request,
    { slug: "oppulence-relationship-refresh" },
    signal,
  );
  const latest = runs[0];
  return latest?.status === "failed" ? (latest.errorCode ?? "") : "";
}

export function fetchRelationshipRefreshBlocker(signal?: AbortSignal): Promise<string> {
  return loadRelationshipRefreshBlocker(requestJson, signal);
}
