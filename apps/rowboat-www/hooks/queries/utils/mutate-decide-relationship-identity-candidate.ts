import { z } from "zod";

import {
  DecideRelationshipIdentityCandidate200Response,
  DecideRelationshipIdentityCandidateBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const DecideRelationshipIdentityCandidateInputSchema =
  DecideRelationshipIdentityCandidateBody;

export type DecideRelationshipIdentityCandidateInput = z.infer<
  typeof DecideRelationshipIdentityCandidateInputSchema
>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Decide relationship identity candidate. Validates the response with
 * DecideRelationshipIdentityCandidate200Response. Do not cast the parsed result. Owned by `use-decide-relationship-identity-candidate.lit.ts`.
 */
export function decideRelationshipIdentityCandidatePath(candidateId: string): string {
  return `/relationship-identity-candidates/${encodeURIComponent(candidateId)}/decisions`;
}

export async function loadDecideRelationshipIdentityCandidate(
  request: RequestJsonFn,
  candidateId: string,
  body: DecideRelationshipIdentityCandidateInput,
  signal?: AbortSignal,
) {
  return request({
    path: decideRelationshipIdentityCandidatePath(candidateId),
    method: "POST",
    schema: DecideRelationshipIdentityCandidate200Response,
    body,
    signal,
  });
}

export function fetchDecideRelationshipIdentityCandidate(
  candidateId: string,
  body: DecideRelationshipIdentityCandidateInput,
  signal?: AbortSignal,
) {
  return loadDecideRelationshipIdentityCandidate(requestJson, candidateId, body, signal);
}
