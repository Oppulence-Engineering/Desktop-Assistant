import { describe, expect, it } from "vitest";

import {
  resyncRelationshipSourceKeys,
  RESYNC_RELATIONSHIP_SOURCE_STALE_TIME,
} from "./resync-relationship-source-keys";

describe("resyncRelationshipSourceKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(resyncRelationshipSourceKeys.list()[0]).toBe("resync-relationship-source");
    expect(resyncRelationshipSourceKeys.detail("abc")).toEqual([
      "resync-relationship-source",
      "detail",
      "abc",
      {},
    ]);
    expect(RESYNC_RELATIONSHIP_SOURCE_STALE_TIME).toBe(15_000);
  });
});
