export const communicationKeys = {
  all: ["communication"] as const,
  policy: (sourceAccountId: string) =>
    [...communicationKeys.all, "policy", sourceAccountId] as const,
  rules: () => [...communicationKeys.all, "rules"] as const,
};

export const COMMUNICATION_POLICY_STALE_TIME = 15_000;
