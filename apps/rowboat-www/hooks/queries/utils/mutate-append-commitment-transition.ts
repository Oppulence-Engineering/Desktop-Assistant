import { z } from "zod";

import {
  AppendCommitmentTransition200Response,
  AppendCommitmentTransitionBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const AppendCommitmentTransitionInputSchema = AppendCommitmentTransitionBody;

export type AppendCommitmentTransitionInput = z.infer<typeof AppendCommitmentTransitionInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Append commitment transition. Validates the response with
 * AppendCommitmentTransition200Response. Do not cast the parsed result. Owned by `use-append-commitment-transition.lit.ts`.
 */
export function appendCommitmentTransitionPath(
  relationshipId: string,
  commitmentId: string,
): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/commitments/${encodeURIComponent(commitmentId)}/transitions`;
}

export async function loadAppendCommitmentTransition(
  request: RequestJsonFn,
  relationshipId: string,
  commitmentId: string,
  body: AppendCommitmentTransitionInput,
  signal?: AbortSignal,
) {
  return request({
    path: appendCommitmentTransitionPath(relationshipId, commitmentId),
    method: "POST",
    schema: AppendCommitmentTransition200Response,
    body,
    signal,
  });
}

export function fetchAppendCommitmentTransition(
  relationshipId: string,
  commitmentId: string,
  body: AppendCommitmentTransitionInput,
  signal?: AbortSignal,
) {
  return loadAppendCommitmentTransition(requestJson, relationshipId, commitmentId, body, signal);
}
