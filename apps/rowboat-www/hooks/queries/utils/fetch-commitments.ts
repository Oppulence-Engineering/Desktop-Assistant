import { ListCommitments200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { withQueryString } from "@/lib/api/query-string";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { CommitmentRegisterFilter, RegisterEntry } from "@/lib/revenue/types";

function commitmentsPath(filter: CommitmentRegisterFilter = {}): string {
  return withQueryString("/commitments", {
    direction: filter.direction,
    state: filter.state?.join(","),
    owner: filter.owner,
    relationshipId: filter.relationshipId,
    dueBefore: filter.dueBefore,
    changedSince: filter.changedSince,
    includeCandidates: filter.includeCandidates || undefined,
    limit: filter.limit,
    offset: filter.offset,
  });
}

export async function loadCommitments(
  request: RequestJsonFn,
  filter: CommitmentRegisterFilter = {},
  signal?: AbortSignal,
): Promise<RegisterEntry[]> {
  const res = await request({
    path: commitmentsPath(filter),
    schema: ListCommitments200Response,
    signal,
  });
  return res.commitments;
}

export function fetchCommitments(
  filter: CommitmentRegisterFilter = {},
  signal?: AbortSignal,
): Promise<RegisterEntry[]> {
  return loadCommitments(requestJson, filter, signal);
}
