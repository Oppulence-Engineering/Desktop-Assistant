import { z } from "zod";

import {
  ApproveRevenueAction200Response,
  ApproveRevenueActionBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ApproveRevenueActionInputSchema = ApproveRevenueActionBody;

export type ApproveRevenueActionInput = z.infer<typeof ApproveRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Approve revenue action. Validates the response with
 * ApproveRevenueAction200Response. Do not cast the parsed result. Owned by `use-approve-revenue-action.lit.ts`.
 */
export function approveRevenueActionPath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/approve`;
}

export async function loadApproveRevenueAction(
  request: RequestJsonFn,
  actionId: string,
  body: ApproveRevenueActionInput,
  signal?: AbortSignal,
) {
  return request({
    path: approveRevenueActionPath(actionId),
    method: "POST",
    schema: ApproveRevenueAction200Response,
    body,
    signal,
  });
}

export function fetchApproveRevenueAction(
  actionId: string,
  body: ApproveRevenueActionInput,
  signal?: AbortSignal,
) {
  return loadApproveRevenueAction(requestJson, actionId, body, signal);
}
