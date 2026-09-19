import { describe, expect, it } from "vitest";

import {
  snoozeRevenueActionKeys,
  SNOOZE_REVENUE_ACTION_STALE_TIME,
} from "./snooze-revenue-action-keys";

describe("snoozeRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(snoozeRevenueActionKeys.list()[0]).toBe("snooze-revenue-action");
    expect(snoozeRevenueActionKeys.detail("abc")).toEqual([
      "snooze-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(SNOOZE_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
