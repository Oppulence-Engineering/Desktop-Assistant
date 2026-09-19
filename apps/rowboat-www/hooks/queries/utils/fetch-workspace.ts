import { GetRevenueWorkspace200Response } from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { RevenueWorkspace } from "@/types/revenue";

const WORKSPACE_PATH = "/revenue-workspaces/current";

export async function loadWorkspace(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<RevenueWorkspace> {
  return (await request({
    path: WORKSPACE_PATH,
    schema: GetRevenueWorkspace200Response,
    signal,
  })) as RevenueWorkspace;
}

export function fetchWorkspace(signal?: AbortSignal): Promise<RevenueWorkspace> {
  return loadWorkspace(requestJson, signal);
}
