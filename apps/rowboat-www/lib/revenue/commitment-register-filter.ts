import type { CommitmentRegisterFilter } from "@/lib/revenue/types";

/** The five views of the commitment register. Each one is a different query. */
export type RegisterView = "we_owe" | "they_owe" | "changed" | "by_account" | "by_owner";

/** The filter each view sends to the register. Kept beside the labels so the
 *  view and its query cannot drift apart. */
export function registerFilterFor(
  view: RegisterView,
  options: {
    relationshipId?: string;
    owner?: string;
    since?: string;
    includeCandidates?: boolean;
  } = {},
): CommitmentRegisterFilter | null {
  const includeCandidates = options.includeCandidates || undefined;
  switch (view) {
    case "we_owe":
      return {
        direction: "promised_by_me",
        state: ["open", "at_risk"],
        includeCandidates,
        limit: 200,
      };
    case "they_owe":
      return {
        direction: "promised_by_them",
        state: ["open", "at_risk"],
        includeCandidates,
        limit: 200,
      };
    case "changed":
      return {
        changedSince: options.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        includeCandidates,
        limit: 200,
      };
    case "by_account":
      return options.relationshipId
        ? { relationshipId: options.relationshipId, includeCandidates, limit: 200 }
        : null;
    case "by_owner":
      return options.owner?.trim()
        ? { owner: options.owner.trim(), includeCandidates, limit: 200 }
        : null;
  }
}
