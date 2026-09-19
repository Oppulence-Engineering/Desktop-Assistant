export const composioKeys = {
  all: ["composio"] as const,
  toolkits: () => [...composioKeys.all, "toolkits"] as const,
  connections: () => [...composioKeys.all, "connections"] as const,
};

export const COMPOSIO_LIST_STALE_TIME = 15_000;
