import { z } from "zod";

import {
  EditRevenueAction200Response,
  EditRevenueActionBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const EditRevenueActionInputSchema = EditRevenueActionBody;

export type EditRevenueActionInput = z.infer<typeof EditRevenueActionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Edit revenue action. Validates the response with
 * EditRevenueAction200Response. Do not cast the parsed result. Owned by `use-edit-revenue-action.lit.ts`.
 */
export function editRevenueActionPath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/edit`;
}

export async function loadEditRevenueAction(
  request: RequestJsonFn,
  actionId: string,
  body: EditRevenueActionInput,
  signal?: AbortSignal,
) {
  return request({
    path: editRevenueActionPath(actionId),
    method: "POST",
    schema: EditRevenueAction200Response,
    body,
    signal,
  });
}

export function fetchEditRevenueAction(
  actionId: string,
  body: EditRevenueActionInput,
  signal?: AbortSignal,
) {
  return loadEditRevenueAction(requestJson, actionId, body, signal);
}
