import { describe, expect, it } from "vitest";

import {
  evaluateRevenueActionKeys,
  EVALUATE_REVENUE_ACTION_STALE_TIME,
} from "./evaluate-revenue-action-keys";

describe("evaluateRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(evaluateRevenueActionKeys.list()[0]).toBe("evaluate-revenue-action");
    expect(evaluateRevenueActionKeys.detail("abc")).toEqual([
      "evaluate-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(EVALUATE_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
