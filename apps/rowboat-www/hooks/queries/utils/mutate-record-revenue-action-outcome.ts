import { z } from "zod";

import {
  RecordRevenueActionOutcome201Response,
  RecordRevenueActionOutcomeBody,
} from "@/lib/api/generated/zod/revenue/revenue";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const RecordRevenueActionOutcomeInputSchema = RecordRevenueActionOutcomeBody;

export type RecordRevenueActionOutcomeInput = z.infer<typeof RecordRevenueActionOutcomeInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Record revenue action outcome. Validates the response with
 * RecordRevenueActionOutcome201Response. Do not cast the parsed result. Owned by `use-record-revenue-action-outcome.lit.ts`.
 */
export function recordRevenueActionOutcomePath(actionId: string): string {
  return `/revenue-actions/${encodeURIComponent(actionId)}/outcomes`;
}

export async function loadRecordRevenueActionOutcome(
  request: RequestJsonFn,
  actionId: string,
  body: RecordRevenueActionOutcomeInput,
  signal?: AbortSignal,
) {
  return request({
    path: recordRevenueActionOutcomePath(actionId),
    method: "POST",
    schema: RecordRevenueActionOutcome201Response,
    body,
    signal,
  });
}

export function fetchRecordRevenueActionOutcome(
  actionId: string,
  body: RecordRevenueActionOutcomeInput,
  signal?: AbortSignal,
) {
  return loadRecordRevenueActionOutcome(requestJson, actionId, body, signal);
}
