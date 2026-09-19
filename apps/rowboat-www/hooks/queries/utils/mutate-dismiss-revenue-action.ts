import { z } from "zod";

import {
  DismissRevenueAction200Response,
  DismissRevenueActionBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const DismissRevenueActionInputSchema = DismissRevenueActionBody;

export type DismissRevenueActionInput = z.infer<typeof DismissRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Dismiss revenue action. Validates the response with
 * DismissRevenueAction200Response. Do not cast the parsed result. Owned by `use-dismiss-revenue-action.lit.ts`.
 */
export function dismissRevenueActionPath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/dismiss`;
}

export async function loadDismissRevenueAction(
  request: RequestJsonFn,
  actionId: string,
  body: DismissRevenueActionInput,
  signal?: AbortSignal,
) {
  return request({
    path: dismissRevenueActionPath(actionId),
    method: "POST",
    schema: DismissRevenueAction200Response,
    body,
    signal,
  });
}

export function fetchDismissRevenueAction(
  actionId: string,
  body: DismissRevenueActionInput,
  signal?: AbortSignal,
) {
  return loadDismissRevenueAction(requestJson, actionId, body, signal);
}
