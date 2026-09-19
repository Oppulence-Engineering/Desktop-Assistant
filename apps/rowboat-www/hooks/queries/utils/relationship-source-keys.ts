/**
 * One cache prefix for source health. The sidebar, report, and revenue
 * workspace all invalidate this list after an OAuth or audit change.
 */
export const relationshipSourceKeys = {
  all: ["relationship-source"] as const,
  lists: () => [...relationshipSourceKeys.all, "list"] as const,
  list: () => [...relationshipSourceKeys.lists(), "statuses"] as const,
  inventory: () => [...relationshipSourceKeys.lists(), "inventory"] as const,
};

export const RELATIONSHIP_SOURCE_LIST_STALE_TIME = 15_000;

/** @deprecated Use relationshipSourceKeys.list(). Kept for existing invalidations. */
export const RELATIONSHIP_SOURCE_STATUS_QUERY_KEY = relationshipSourceKeys.list();
