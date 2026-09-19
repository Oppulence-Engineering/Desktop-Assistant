import { loadRelationships } from "@/hooks/queries/utils/fetch-relationships";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import { getRelationshipTimeline } from "@/lib/revenue/revenue";
import {
  collapseWorkspaceNotes,
  mapSettledWithConcurrency,
  type WorkspaceNote,
} from "@/lib/revenue/revenue-records";
import type { RelationshipObservation, RevenueRelationship } from "@/lib/revenue/types";

export type WorkspaceNotesBundle = {
  notes: WorkspaceNote[];
  relationships: RevenueRelationship[];
  failedTimelineCount: number;
};

export async function loadWorkspaceNotes(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<WorkspaceNotesBundle> {
  const relationships = (await loadRelationships(request, {}, signal)).filter(
    (relationship) => relationship.kind !== "person",
  );
  const results = await mapSettledWithConcurrency(relationships, 6, (relationship) =>
    getRelationshipTimeline(relationship.id, 200, signal),
  );
  const successfulRelationships: RevenueRelationship[] = [];
  const timelines: RelationshipObservation[][] = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    successfulRelationships.push(relationships[index]);
    timelines.push(result.value);
  });
  return {
    notes: collapseWorkspaceNotes(successfulRelationships, timelines),
    relationships,
    failedTimelineCount: results.length - successfulRelationships.length,
  };
}

export function fetchWorkspaceNotes(signal?: AbortSignal): Promise<WorkspaceNotesBundle> {
  return loadWorkspaceNotes(requestJson, signal);
}
