import { z } from "zod";

import {
  ApproveRelationshipRecommendation200Response,
  ApproveRelationshipRecommendationBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ApproveRelationshipRecommendationInputSchema = ApproveRelationshipRecommendationBody;

export type ApproveRelationshipRecommendationInput = z.infer<
  typeof ApproveRelationshipRecommendationInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Approve relationship recommendation. Validates the response with
 * ApproveRelationshipRecommendation200Response. Do not cast the parsed result. Owned by `use-approve-relationship-recommendation.lit.ts`.
 */
export function approveRelationshipRecommendationPath(actionId: string): string {
  return `/relationship-recommendations/${encodeURIComponent(actionId)}/approve`;
}

export async function loadApproveRelationshipRecommendation(
  request: RequestJsonFn,
  actionId: string,
  body: ApproveRelationshipRecommendationInput,
  signal?: AbortSignal,
) {
  return request({
    path: approveRelationshipRecommendationPath(actionId),
    method: "POST",
    schema: ApproveRelationshipRecommendation200Response,
    body,
    signal,
  });
}

export function fetchApproveRelationshipRecommendation(
  actionId: string,
  body: ApproveRelationshipRecommendationInput,
  signal?: AbortSignal,
) {
  return loadApproveRelationshipRecommendation(requestJson, actionId, body, signal);
}
