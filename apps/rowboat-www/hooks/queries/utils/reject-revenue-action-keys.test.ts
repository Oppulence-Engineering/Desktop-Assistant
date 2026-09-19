import { describe, expect, it } from "vitest";

import {
  rejectRevenueActionKeys,
  REJECT_REVENUE_ACTION_STALE_TIME,
} from "./reject-revenue-action-keys";

describe("rejectRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(rejectRevenueActionKeys.list()[0]).toBe("reject-revenue-action");
    expect(rejectRevenueActionKeys.detail("abc")).toEqual([
      "reject-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(REJECT_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
