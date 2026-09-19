import { describe, expect, it } from "vitest";

import {
  linkRevenueWorkspaceKeys,
  LINK_REVENUE_WORKSPACE_STALE_TIME,
} from "./link-revenue-workspace-keys";

describe("linkRevenueWorkspaceKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(linkRevenueWorkspaceKeys.list()[0]).toBe("link-revenue-workspace");
    expect(linkRevenueWorkspaceKeys.detail("abc")).toEqual([
      "link-revenue-workspace",
      "detail",
      "abc",
      {},
    ]);
    expect(LINK_REVENUE_WORKSPACE_STALE_TIME).toBe(15_000);
  });
});
