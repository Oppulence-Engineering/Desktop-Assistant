import { z } from "zod";

import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { ActionProposal } from "@/lib/actions/types";

const ActionProposalSchema = z
  .object({
    id: z.string(),
    target: z.string(),
    kind: z.string(),
    paramsJson: z.string().optional(),
    financial: z.boolean(),
    rationale: z.string().optional(),
    status: z.enum([
      "pending",
      "approved",
      "rejected",
      "executed",
      "failed",
      "executed_unconfirmed",
      "expired",
    ]),
    correlationId: z.string().optional(),
    entityId: z.string().optional(),
    originRunId: z.string().optional(),
    resultRef: z.string().optional(),
    reason: z.string().optional(),
    returnEventId: z.string().optional(),
    approvedAt: z.string().optional(),
    executedAt: z.string().optional(),
    resolvedAt: z.string().optional(),
    createdAt: z.string(),
  })
  .passthrough();

const PendingProposalsSchema = z.object({
  proposals: z.array(ActionProposalSchema).optional(),
});

export async function loadPendingActionProposals(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<ActionProposal[]> {
  const body = await request({
    path: "/action-proposals?status=pending",
    schema: PendingProposalsSchema,
    signal,
  });
  return (body.proposals ?? []) as ActionProposal[];
}

export function fetchPendingActionProposals(signal?: AbortSignal): Promise<ActionProposal[]> {
  return loadPendingActionProposals(requestJson, signal);
}
