import { z } from "zod";

import {
  RejectRevenueAction200Response,
  RejectRevenueActionBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const RejectRevenueActionInputSchema = RejectRevenueActionBody;

export type RejectRevenueActionInput = z.infer<typeof RejectRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Reject revenue action. Validates the response with
 * RejectRevenueAction200Response. Do not cast the parsed result. Owned by `use-reject-revenue-action.lit.ts`.
 */
export function rejectRevenueActionPath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/reject`;
}

export async function loadRejectRevenueAction(
  request: RequestJsonFn,
  actionId: string,
  body: RejectRevenueActionInput,
  signal?: AbortSignal,
) {
  return request({
    path: rejectRevenueActionPath(actionId),
    method: "POST",
    schema: RejectRevenueAction200Response,
    body,
    signal,
  });
}

export function fetchRejectRevenueAction(
  actionId: string,
  body: RejectRevenueActionInput,
  signal?: AbortSignal,
) {
  return loadRejectRevenueAction(requestJson, actionId, body, signal);
}
