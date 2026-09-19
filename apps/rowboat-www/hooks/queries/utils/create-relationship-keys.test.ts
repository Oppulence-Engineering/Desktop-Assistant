import { describe, expect, it } from "vitest";

import { createRelationshipKeys, CREATE_RELATIONSHIP_STALE_TIME } from "./create-relationship-keys";

describe("createRelationshipKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(createRelationshipKeys.list()[0]).toBe("create-relationship");
    expect(createRelationshipKeys.detail("abc")).toEqual([
      "create-relationship",
      "detail",
      "abc",
      {},
    ]);
    expect(CREATE_RELATIONSHIP_STALE_TIME).toBe(15_000);
  });
});
