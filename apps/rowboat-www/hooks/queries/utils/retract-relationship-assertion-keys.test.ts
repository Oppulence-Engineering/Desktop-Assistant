import { describe, expect, it } from "vitest";

import {
  retractRelationshipAssertionKeys,
  RETRACT_RELATIONSHIP_ASSERTION_STALE_TIME,
} from "./retract-relationship-assertion-keys";

describe("retractRelationshipAssertionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(retractRelationshipAssertionKeys.list()[0]).toBe("retract-relationship-assertion");
    expect(retractRelationshipAssertionKeys.detail("abc")).toEqual([
      "retract-relationship-assertion",
      "detail",
      "abc",
      {},
    ]);
    expect(RETRACT_RELATIONSHIP_ASSERTION_STALE_TIME).toBe(15_000);
  });
});
