import { z } from "zod";

import {
  ResolveRelationshipContradiction201Response,
  ResolveRelationshipContradictionBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const ResolveRelationshipContradictionInputSchema = ResolveRelationshipContradictionBody;

export type ResolveRelationshipContradictionInput = z.infer<
  typeof ResolveRelationshipContradictionInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Resolve relationship contradiction. Validates the response with
 * ResolveRelationshipContradiction201Response. Do not cast the parsed result. Owned by `use-resolve-relationship-contradiction.lit.ts`.
 */
export function resolveRelationshipContradictionPath(
  relationshipId: string,
  caseId: string,
): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/contradictions/${encodeURIComponent(caseId)}/resolve`;
}

export async function loadResolveRelationshipContradiction(
  request: RequestJsonFn,
  relationshipId: string,
  caseId: string,
  body: ResolveRelationshipContradictionInput,
  signal?: AbortSignal,
) {
  return request({
    path: resolveRelationshipContradictionPath(relationshipId, caseId),
    method: "POST",
    schema: ResolveRelationshipContradiction201Response,
    body,
    signal,
  });
}

export function fetchResolveRelationshipContradiction(
  relationshipId: string,
  caseId: string,
  body: ResolveRelationshipContradictionInput,
  signal?: AbortSignal,
) {
  return loadResolveRelationshipContradiction(requestJson, relationshipId, caseId, body, signal);
}
