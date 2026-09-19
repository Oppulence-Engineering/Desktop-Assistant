import { describe, expect, it } from "vitest";

import {
  rejectRelationshipRecommendationKeys,
  REJECT_RELATIONSHIP_RECOMMENDATION_STALE_TIME,
} from "./reject-relationship-recommendation-keys";

describe("rejectRelationshipRecommendationKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(rejectRelationshipRecommendationKeys.list()[0]).toBe(
      "reject-relationship-recommendation",
    );
    expect(rejectRelationshipRecommendationKeys.detail("abc")).toEqual([
      "reject-relationship-recommendation",
      "detail",
      "abc",
      {},
    ]);
    expect(REJECT_RELATIONSHIP_RECOMMENDATION_STALE_TIME).toBe(15_000);
  });
});
