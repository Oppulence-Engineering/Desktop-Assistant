import { z } from "zod";

import { ExecuteRevenueAction200Response } from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ExecuteRevenueActionInputSchema = z.undefined();

export type ExecuteRevenueActionInput = z.infer<typeof ExecuteRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Execute revenue action. Validates the response with
 * ExecuteRevenueAction200Response. Do not cast the parsed result. Owned by `use-execute-revenue-action.lit.ts`.
 */
export function executeRevenueActionPath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/execute`;
}

export async function loadExecuteRevenueAction(
  request: RequestJsonFn,
  actionId: string,
  signal?: AbortSignal,
) {
  return request({
    path: executeRevenueActionPath(actionId),
    method: "POST",
    schema: ExecuteRevenueAction200Response,
    signal,
  });
}

export function fetchExecuteRevenueAction(actionId: string, signal?: AbortSignal) {
  return loadExecuteRevenueAction(requestJson, actionId, signal);
}
