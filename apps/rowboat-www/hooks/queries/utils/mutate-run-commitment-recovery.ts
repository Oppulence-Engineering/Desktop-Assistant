import { z } from "zod";

import {
  RunCommitmentRecovery200Response,
  RunCommitmentRecoveryBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const RunCommitmentRecoveryInputSchema = RunCommitmentRecoveryBody;

export type RunCommitmentRecoveryInput = z.infer<typeof RunCommitmentRecoveryInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Run commitment recovery. Validates the response with
 * RunCommitmentRecovery200Response. Do not cast the parsed result. Owned by `use-run-commitment-recovery.lit.ts`.
 */
export function runCommitmentRecoveryPath(relationshipId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/commitment-recovery/run`;
}

export async function loadRunCommitmentRecovery(
  request: RequestJsonFn,
  relationshipId: string,
  body: RunCommitmentRecoveryInput,
  signal?: AbortSignal,
) {
  return request({
    path: runCommitmentRecoveryPath(relationshipId),
    method: "POST",
    schema: RunCommitmentRecovery200Response,
    body,
    signal,
  });
}

export function fetchRunCommitmentRecovery(
  relationshipId: string,
  body: RunCommitmentRecoveryInput,
  signal?: AbortSignal,
) {
  return loadRunCommitmentRecovery(requestJson, relationshipId, body, signal);
}
