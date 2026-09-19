import { z } from "zod";

import {
  AcknowledgeMissionControl201Response,
  AcknowledgeMissionControlBody,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";

export const AcknowledgeMissionControlInputSchema = AcknowledgeMissionControlBody;

export type AcknowledgeMissionControlInput = z.infer<typeof AcknowledgeMissionControlInputSchema>;
/**
 * @oppulence-gen kind=mutation
 * Same-origin BFF write for Acknowledge mission control. Validates the response with
 * AcknowledgeMissionControl201Response. Do not cast the parsed result. Owned by `use-acknowledge-mission-control.lit.ts`.
 */
export function acknowledgeMissionControlPath(relationshipId: string): string {
  return `/relationships/${encodeURIComponent(relationshipId)}/acknowledgements`;
}

export async function loadAcknowledgeMissionControl(
  request: RequestJsonFn,
  relationshipId: string,
  body: AcknowledgeMissionControlInput,
  signal?: AbortSignal,
) {
  return request({
    path: acknowledgeMissionControlPath(relationshipId),
    method: "POST",
    schema: AcknowledgeMissionControl201Response,
    body,
    signal,
  });
}

export function fetchAcknowledgeMissionControl(
  relationshipId: string,
  body: AcknowledgeMissionControlInput,
  signal?: AbortSignal,
) {
  return loadAcknowledgeMissionControl(requestJson, relationshipId, body, signal);
}
