import { describe, expect, it } from "vitest";

import {
  correctRelationshipKeys,
  CORRECT_RELATIONSHIP_STALE_TIME,
} from "./correct-relationship-keys";

describe("correctRelationshipKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(correctRelationshipKeys.list()[0]).toBe("correct-relationship");
    expect(correctRelationshipKeys.detail("abc")).toEqual([
      "correct-relationship",
      "detail",
      "abc",
      {},
    ]);
    expect(CORRECT_RELATIONSHIP_STALE_TIME).toBe(15_000);
  });
});
