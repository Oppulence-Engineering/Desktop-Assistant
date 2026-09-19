import { describe, expect, it } from "vitest";

import {
  decideRelationshipAttentionKeys,
  DECIDE_RELATIONSHIP_ATTENTION_STALE_TIME,
} from "./decide-relationship-attention-keys";

describe("decideRelationshipAttentionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(decideRelationshipAttentionKeys.list()[0]).toBe("decide-relationship-attention");
    expect(decideRelationshipAttentionKeys.detail("abc")).toEqual([
      "decide-relationship-attention",
      "detail",
      "abc",
      {},
    ]);
    expect(DECIDE_RELATIONSHIP_ATTENTION_STALE_TIME).toBe(15_000);
  });
});
