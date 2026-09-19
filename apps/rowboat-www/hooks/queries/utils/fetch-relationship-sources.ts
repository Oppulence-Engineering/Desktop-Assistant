import {
  GetRelationshipSourceInventory200Response,
  GetRelationshipSourceStatuses200Response,
} from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { requestJson, type RequestJsonFn } from "@/lib/api/request-json";
import type { RelationshipSourceInventoryItem, RelationshipSourceStatus } from "@/types/revenue";

const RELATIONSHIP_SOURCE_STATUS_PATH = "/relationship-sources/status";

export async function loadRelationshipSourceStatuses(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<RelationshipSourceStatus[]> {
  const body = await request({
    path: RELATIONSHIP_SOURCE_STATUS_PATH,
    schema: GetRelationshipSourceStatuses200Response,
    signal,
  });
  return (body.sources ?? []) as RelationshipSourceStatus[];
}

export function fetchRelationshipSourceStatuses(
  signal?: AbortSignal,
): Promise<RelationshipSourceStatus[]> {
  return loadRelationshipSourceStatuses(requestJson, signal);
}

const RELATIONSHIP_SOURCE_INVENTORY_PATH = "/relationship-sources";

export async function loadRelationshipSources(
  request: RequestJsonFn,
  signal?: AbortSignal,
): Promise<RelationshipSourceInventoryItem[]> {
  const body = await request({
    path: RELATIONSHIP_SOURCE_INVENTORY_PATH,
    schema: GetRelationshipSourceInventory200Response,
    signal,
  });
  return (body.sources ?? []) as RelationshipSourceInventoryItem[];
}

export function fetchRelationshipSources(
  signal?: AbortSignal,
): Promise<RelationshipSourceInventoryItem[]> {
  return loadRelationshipSources(requestJson, signal);
}
