import { z } from "zod";

import {
  ShareMutualActionPlan200Response,
  ShareMutualActionPlanBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ShareMutualActionPlanInputSchema = ShareMutualActionPlanBody;

export type ShareMutualActionPlanInput = z.infer<typeof ShareMutualActionPlanInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Share mutual action plan. Validates the response with
 * ShareMutualActionPlan200Response. Do not cast the parsed result. Owned by `use-share-mutual-action-plan.lit.ts`.
 */
export function shareMutualActionPlanPath(relationshipId: string, planId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans/${encodeURIComponent(planId)}/share`;
}

export async function loadShareMutualActionPlan(
  request: RequestJsonFn,
  relationshipId: string,
  planId: string,
  body: ShareMutualActionPlanInput,
  signal?: AbortSignal,
) {
  return request({
    path: shareMutualActionPlanPath(relationshipId, planId),
    method: "POST",
    schema: ShareMutualActionPlan200Response,
    body,
    signal,
  });
}

export function fetchShareMutualActionPlan(
  relationshipId: string,
  planId: string,
  body: ShareMutualActionPlanInput,
  signal?: AbortSignal,
) {
  return loadShareMutualActionPlan(requestJson, relationshipId, planId, body, signal);
}
