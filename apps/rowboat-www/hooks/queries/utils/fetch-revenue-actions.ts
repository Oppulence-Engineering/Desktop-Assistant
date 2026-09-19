import { ListRevenueActions200Response } from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { RevenueAction } from "@/types/revenue";

function revenueActionsPath(queueStatus: string, limit: number): string {
  const params = new URLSearchParams({ queueStatus, limit: String(limit) });
  return `/revenue-actions?${params.toString()}`;
}

export async function loadRevenueActions(
  request: RequestJsonFn,
  queueStatus = "open",
  limit = 25,
  signal?: AbortSignal,
): Promise<RevenueAction[]> {
  const body = await request({
    path: revenueActionsPath(queueStatus, limit),
    schema: ListRevenueActions200Response,
    signal,
  });
  return body.actions as RevenueAction[];
}

export function fetchRevenueActions(
  queueStatus = "open",
  limit = 25,
  signal?: AbortSignal,
): Promise<RevenueAction[]> {
  return loadRevenueActions(requestJson, queueStatus, limit, signal);
}
