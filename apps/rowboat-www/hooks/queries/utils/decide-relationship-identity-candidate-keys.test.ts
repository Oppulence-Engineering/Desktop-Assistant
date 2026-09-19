import { describe, expect, it } from "vitest";

import {
  decideRelationshipIdentityCandidateKeys,
  DECIDE_RELATIONSHIP_IDENTITY_CANDIDATE_STALE_TIME,
} from "./decide-relationship-identity-candidate-keys";

describe("decideRelationshipIdentityCandidateKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(decideRelationshipIdentityCandidateKeys.list()[0]).toBe(
      "decide-relationship-identity-candidate",
    );
    expect(decideRelationshipIdentityCandidateKeys.detail("abc")).toEqual([
      "decide-relationship-identity-candidate",
      "detail",
      "abc",
      {},
    ]);
    expect(DECIDE_RELATIONSHIP_IDENTITY_CANDIDATE_STALE_TIME).toBe(15_000);
  });
});
