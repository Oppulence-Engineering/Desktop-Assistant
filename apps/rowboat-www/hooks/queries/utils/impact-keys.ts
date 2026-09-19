export const impactKeys = {
  all: ["revenue-impact"] as const,
  bundle: () => [...impactKeys.all, "bundle"] as const,
};

export const IMPACT_BUNDLE_STALE_TIME = 15_000;
