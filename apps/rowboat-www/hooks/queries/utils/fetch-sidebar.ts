import { z } from "zod";

import { isOptionalRequestFailure, requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import { loadAgentSlugs } from "@/hooks/queries/utils/fetch-agents";

const SidebarTaskSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
    active: z.boolean().optional(),
  })
  .passthrough();

const SidebarTaskListSchema = z
  .object({
    tasks: z.array(SidebarTaskSchema).optional(),
  })
  .passthrough();

const SidebarRunSchema = z
  .object({
    runId: z.string(),
    slug: z.string(),
    status: z.string().optional(),
  })
  .passthrough();

const SidebarRunListSchema = z
  .object({
    runs: z.array(SidebarRunSchema).optional(),
  })
  .passthrough();

export type SidebarNavItem = { label: string; value: string };

/**
 * Sidebar labels only. Generated background-task contracts are strictObject
 * and would empty the nav when the API adds fields the client has not regenerated.
 */
export async function loadSidebarTasks(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<SidebarNavItem[]> {
  try {
    const data = await request({
      path: "/background-tasks",
      schema: SidebarTaskListSchema,
      signal,
    });
    return (data.tasks ?? [])
      .filter((task) => typeof task.slug === "string")
      .map((task) => ({
        value: task.slug,
        label: task.name || task.slug,
      }));
  } catch (error) {
    if (isOptionalRequestFailure(error)) return [];
    throw error;
  }
}

export async function loadSidebarRuns(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<SidebarNavItem[]> {
  try {
    const data = await request({
      path: "/background-task-runs",
      schema: SidebarRunListSchema,
      signal,
    });
    return (data.runs ?? [])
      .filter((run) => typeof run.runId === "string" && typeof run.slug === "string")
      .slice(0, 8)
      .map((run) => ({
        value: `${run.slug}/${run.runId}`,
        label: run.status ? `${run.slug} · ${run.status}` : run.slug,
      }));
  } catch (error) {
    if (isOptionalRequestFailure(error)) return [];
    throw error;
  }
}

export function fetchSidebarAgents(signal?: AbortSignal): Promise<string[]> {
  return loadAgentSlugs(requestJson, signal);
}

export function fetchSidebarTasks(signal?: AbortSignal): Promise<SidebarNavItem[]> {
  return loadSidebarTasks(requestJson, signal);
}

export function fetchSidebarRuns(signal?: AbortSignal): Promise<SidebarNavItem[]> {
  return loadSidebarRuns(requestJson, signal);
}
