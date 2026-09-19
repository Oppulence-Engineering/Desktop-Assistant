import { describe, expect, it } from "vitest";

import {
  approveRevenueActionKeys,
  APPROVE_REVENUE_ACTION_STALE_TIME,
} from "./approve-revenue-action-keys";

describe("approveRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(approveRevenueActionKeys.list()[0]).toBe("approve-revenue-action");
    expect(approveRevenueActionKeys.detail("abc")).toEqual([
      "approve-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(APPROVE_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
