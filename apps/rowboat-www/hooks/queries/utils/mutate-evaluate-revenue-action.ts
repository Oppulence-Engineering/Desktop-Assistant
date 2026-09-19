import { z } from "zod";

import { EvaluateRevenueAction200Response } from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const EvaluateRevenueActionInputSchema = z.undefined();

export type EvaluateRevenueActionInput = z.infer<typeof EvaluateRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Evaluate revenue action. Validates the response with
 * EvaluateRevenueAction200Response. Do not cast the parsed result. Owned by `use-evaluate-revenue-action.lit.ts`.
 */
export function evaluateRevenueActionPath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/evaluate`;
}

export async function loadEvaluateRevenueAction(
  request: RequestJsonFn,
  actionId: string,
  signal?: AbortSignal,
) {
  return request({
    path: evaluateRevenueActionPath(actionId),
    method: "POST",
    schema: EvaluateRevenueAction200Response,
    signal,
  });
}

export function fetchEvaluateRevenueAction(actionId: string, signal?: AbortSignal) {
  return loadEvaluateRevenueAction(requestJson, actionId, signal);
}
