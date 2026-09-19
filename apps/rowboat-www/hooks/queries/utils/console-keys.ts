export const consoleKeys = {
  all: ["console"] as const,
  preferences: () => [...consoleKeys.all, "preferences"] as const,
  resources: () => [...consoleKeys.all, "resources"] as const,
  resourceKind: (kind: string) => [...consoleKeys.resources(), kind] as const,
};

export const CONSOLE_PREFERENCES_STALE_TIME = 15_000;
export const CONSOLE_RESOURCE_STALE_TIME = 15_000;
