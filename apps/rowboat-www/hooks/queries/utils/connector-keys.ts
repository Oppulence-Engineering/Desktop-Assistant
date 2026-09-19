export const connectorKeys = {
  all: ["connector"] as const,
  list: () => [...connectorKeys.all, "list"] as const,
};

export const CONNECTOR_LIST_STALE_TIME = 15_000;
