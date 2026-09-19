import { describe, expect, it } from "vitest";

import {
  disconnectRelationshipSourceKeys,
  DISCONNECT_RELATIONSHIP_SOURCE_STALE_TIME,
} from "./disconnect-relationship-source-keys";

describe("disconnectRelationshipSourceKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(disconnectRelationshipSourceKeys.list()[0]).toBe("disconnect-relationship-source");
    expect(disconnectRelationshipSourceKeys.detail("abc")).toEqual([
      "disconnect-relationship-source",
      "detail",
      "abc",
      {},
    ]);
    expect(DISCONNECT_RELATIONSHIP_SOURCE_STALE_TIME).toBe(15_000);
  });
});
