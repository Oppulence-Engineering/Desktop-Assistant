import { describe, expect, it } from "vitest";

import {
  resolveRelationshipContradictionKeys,
  RESOLVE_RELATIONSHIP_CONTRADICTION_STALE_TIME,
} from "./resolve-relationship-contradiction-keys";

describe("resolveRelationshipContradictionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(resolveRelationshipContradictionKeys.list()[0]).toBe(
      "resolve-relationship-contradiction",
    );
    expect(resolveRelationshipContradictionKeys.detail("abc")).toEqual([
      "resolve-relationship-contradiction",
      "detail",
      "abc",
      {},
    ]);
    expect(RESOLVE_RELATIONSHIP_CONTRADICTION_STALE_TIME).toBe(15_000);
  });
});
