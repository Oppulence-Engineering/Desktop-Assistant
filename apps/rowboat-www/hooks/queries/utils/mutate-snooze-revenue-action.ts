import { z } from "zod";

import {
  SnoozeRevenueAction200Response,
  SnoozeRevenueActionBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const SnoozeRevenueActionInputSchema = SnoozeRevenueActionBody;

export type SnoozeRevenueActionInput = z.infer<typeof SnoozeRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Snooze revenue action. Validates the response with
 * SnoozeRevenueAction200Response. Do not cast the parsed result. Owned by `use-snooze-revenue-action.lit.ts`.
 */
export function snoozeRevenueActionPath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/snooze`;
}

export async function loadSnoozeRevenueAction(
  request: RequestJsonFn,
  actionId: string,
  body: SnoozeRevenueActionInput,
  signal?: AbortSignal,
) {
  return request({
    path: snoozeRevenueActionPath(actionId),
    method: "POST",
    schema: SnoozeRevenueAction200Response,
    body,
    signal,
  });
}

export function fetchSnoozeRevenueAction(
  actionId: string,
  body: SnoozeRevenueActionInput,
  signal?: AbortSignal,
) {
  return loadSnoozeRevenueAction(requestJson, actionId, body, signal);
}
