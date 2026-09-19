import { z } from "zod";

import {
  ApproveMutualActionPlan200Response,
  ApproveMutualActionPlanBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ApproveMutualActionPlanInputSchema = ApproveMutualActionPlanBody;

export type ApproveMutualActionPlanInput = z.infer<typeof ApproveMutualActionPlanInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Approve mutual action plan. Validates the response with
 * ApproveMutualActionPlan200Response. Do not cast the parsed result. Owned by `use-approve-mutual-action-plan.lit.ts`.
 */
export function approveMutualActionPlanPath(relationshipId: string, planId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans/${encodeURIComponent(planId)}/approve`;
}

export async function loadApproveMutualActionPlan(
  request: RequestJsonFn,
  relationshipId: string,
  planId: string,
  body: ApproveMutualActionPlanInput,
  signal?: AbortSignal,
) {
  return request({
    path: approveMutualActionPlanPath(relationshipId, planId),
    method: "POST",
    schema: ApproveMutualActionPlan200Response,
    body,
    signal,
  });
}

export function fetchApproveMutualActionPlan(
  relationshipId: string,
  planId: string,
  body: ApproveMutualActionPlanInput,
  signal?: AbortSignal,
) {
  return loadApproveMutualActionPlan(requestJson, relationshipId, planId, body, signal);
}
