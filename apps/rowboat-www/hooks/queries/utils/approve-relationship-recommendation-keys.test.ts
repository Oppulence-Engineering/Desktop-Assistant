import { describe, expect, it } from "vitest";

import {
  approveRelationshipRecommendationKeys,
  APPROVE_RELATIONSHIP_RECOMMENDATION_STALE_TIME,
} from "./approve-relationship-recommendation-keys";

describe("approveRelationshipRecommendationKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(approveRelationshipRecommendationKeys.list()[0]).toBe(
      "approve-relationship-recommendation",
    );
    expect(approveRelationshipRecommendationKeys.detail("abc")).toEqual([
      "approve-relationship-recommendation",
      "detail",
      "abc",
      {},
    ]);
    expect(APPROVE_RELATIONSHIP_RECOMMENDATION_STALE_TIME).toBe(15_000);
  });
});
