export const artifactKeys = {
  all: ["dashboard-artifact"] as const,
  detail: (kind?: string, name?: string) =>
    [...artifactKeys.all, "detail", kind ?? "", name ?? ""] as const,
};

export const ARTIFACT_DETAIL_STALE_TIME = 15_000;
