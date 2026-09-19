import { ListCommitments200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { CommitmentRegisterFilter, RegisterEntry } from "@/types/revenue";

function commitmentsPath(filter: CommitmentRegisterFilter = {}): string {
  const params = new URLSearchParams();
  if (filter.direction) params.set("direction", filter.direction);
  if (filter.state?.length) params.set("state", filter.state.join(","));
  if (filter.owner) params.set("owner", filter.owner);
  if (filter.relationshipId) params.set("relationshipId", filter.relationshipId);
  if (filter.dueBefore) params.set("dueBefore", filter.dueBefore);
  if (filter.changedSince) params.set("changedSince", filter.changedSince);
  if (filter.includeCandidates) params.set("includeCandidates", "true");
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const query = params.toString();
  return `/commitments${query ? `?${query}` : ""}`;
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
  return res.commitments.map((row) => ({
    ...row,
    dueAt: row.dueAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
  })) as RegisterEntry[];
}

export function fetchCommitments(
  filter: CommitmentRegisterFilter = {},
  signal?: AbortSignal,
): Promise<RegisterEntry[]> {
  return loadCommitments(requestJson, filter, signal);
}
