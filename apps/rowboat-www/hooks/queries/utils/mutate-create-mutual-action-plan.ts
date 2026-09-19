import { z } from "zod";

import {
  CreateMutualActionPlan201Response,
  CreateMutualActionPlanBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const CreateMutualActionPlanInputSchema = CreateMutualActionPlanBody;

export type CreateMutualActionPlanInput = z.infer<typeof CreateMutualActionPlanInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Create mutual action plan. Validates the response with
 * CreateMutualActionPlan201Response. Do not cast the parsed result. Owned by `use-create-mutual-action-plan.lit.ts`.
 */
export function createMutualActionPlanPath(relationshipId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/mutual-action-plans`;
}

export async function loadCreateMutualActionPlan(
  request: RequestJsonFn,
  relationshipId: string,
  body: CreateMutualActionPlanInput,
  signal?: AbortSignal,
) {
  return request({
    path: createMutualActionPlanPath(relationshipId),
    method: "POST",
    schema: CreateMutualActionPlan201Response,
    body,
    signal,
  });
}

export function fetchCreateMutualActionPlan(
  relationshipId: string,
  body: CreateMutualActionPlanInput,
  signal?: AbortSignal,
) {
  return loadCreateMutualActionPlan(requestJson, relationshipId, body, signal);
}
