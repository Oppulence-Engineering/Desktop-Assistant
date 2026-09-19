import { describe, expect, it } from "vitest";

import {
  recordRevenueActionOutcomeKeys,
  RECORD_REVENUE_ACTION_OUTCOME_STALE_TIME,
} from "./record-revenue-action-outcome-keys";

describe("recordRevenueActionOutcomeKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(recordRevenueActionOutcomeKeys.list()[0]).toBe("record-revenue-action-outcome");
    expect(recordRevenueActionOutcomeKeys.detail("abc")).toEqual([
      "record-revenue-action-outcome",
      "detail",
      "abc",
      {},
    ]);
    expect(RECORD_REVENUE_ACTION_OUTCOME_STALE_TIME).toBe(15_000);
  });
});
