import { describe, expect, it } from "vitest";

import {
  dismissRevenueActionKeys,
  DISMISS_REVENUE_ACTION_STALE_TIME,
} from "./dismiss-revenue-action-keys";

describe("dismissRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(dismissRevenueActionKeys.list()[0]).toBe("dismiss-revenue-action");
    expect(dismissRevenueActionKeys.detail("abc")).toEqual([
      "dismiss-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(DISMISS_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
