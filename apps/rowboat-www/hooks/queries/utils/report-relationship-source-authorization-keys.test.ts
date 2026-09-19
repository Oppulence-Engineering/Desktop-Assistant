import { describe, expect, it } from "vitest";

import {
  reportRelationshipSourceAuthorizationKeys,
  REPORT_RELATIONSHIP_SOURCE_AUTHORIZATION_STALE_TIME,
} from "./report-relationship-source-authorization-keys";

describe("reportRelationshipSourceAuthorizationKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(reportRelationshipSourceAuthorizationKeys.list()[0]).toBe(
      "report-relationship-source-authorization",
    );
    expect(reportRelationshipSourceAuthorizationKeys.detail("abc")).toEqual([
      "report-relationship-source-authorization",
      "detail",
      "abc",
      {},
    ]);
    expect(REPORT_RELATIONSHIP_SOURCE_AUTHORIZATION_STALE_TIME).toBe(15_000);
  });
});
