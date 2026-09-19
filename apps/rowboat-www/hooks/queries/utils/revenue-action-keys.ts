export const revenueActionKeys = {
  all: ["revenue-action"] as const,
  lists: () => [...revenueActionKeys.all, "list"] as const,
  list: (filter: string, limit = 50) => [...revenueActionKeys.lists(), filter, limit] as const,
};

export const REVENUE_ACTION_LIST_STALE_TIME = 15_000;
