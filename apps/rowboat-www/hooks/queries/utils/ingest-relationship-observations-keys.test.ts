import { describe, expect, it } from "vitest";

import {
  ingestRelationshipObservationsKeys,
  INGEST_RELATIONSHIP_OBSERVATIONS_STALE_TIME,
} from "./ingest-relationship-observations-keys";

describe("ingestRelationshipObservationsKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(ingestRelationshipObservationsKeys.list()[0]).toBe("ingest-relationship-observations");
    expect(ingestRelationshipObservationsKeys.detail("abc")).toEqual([
      "ingest-relationship-observations",
      "detail",
      "abc",
      {},
    ]);
    expect(INGEST_RELATIONSHIP_OBSERVATIONS_STALE_TIME).toBe(15_000);
  });
});
