import type { RelationshipSourceStatus } from "@x/shared/src/relationships.js";

export type RelationshipSourceHealth = "healthy" | "syncing" | "needs_attention";

const SYNCING_STATUSES = new Set(["connected", "backfilling"]);

export function relationshipSourceHealth(source: RelationshipSourceStatus): RelationshipSourceHealth {
  if (source.missingScopes.length > 0 || source.errorCode || source.lastError) {
    return "needs_attention";
  }
  if (source.status === "live") return "healthy";
  if (SYNCING_STATUSES.has(source.status)) return "syncing";
  return "needs_attention";
}

export function relationshipSourceHealthSummary(statuses: RelationshipSourceStatus[]) {
  const healthy: RelationshipSourceStatus[] = [];
  const syncing: RelationshipSourceStatus[] = [];
  const needsAttention: RelationshipSourceStatus[] = [];

  for (const source of statuses) {
    const health = relationshipSourceHealth(source);
    if (health === "healthy") healthy.push(source);
    else if (health === "syncing") syncing.push(source);
    else needsAttention.push(source);
  }

  return { healthy, syncing, needsAttention };
}

export function relationshipSourceStatusLabel(source: RelationshipSourceStatus): string {
  const health = relationshipSourceHealth(source);
  if (health === "healthy") return "Healthy";
  if (health === "syncing") return source.status === "backfilling" ? "Building history" : "Connecting";
  if (source.missingScopes.length > 0) return "Permission needed";
  if (source.status === "stale") return "Stale";
  if (source.status === "disconnected" || source.status === "revoked") return "Disconnected";
  return "Needs attention";
}
