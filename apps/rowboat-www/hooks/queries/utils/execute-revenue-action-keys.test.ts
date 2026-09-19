import { describe, expect, it } from "vitest";

import {
  executeRevenueActionKeys,
  EXECUTE_REVENUE_ACTION_STALE_TIME,
} from "./execute-revenue-action-keys";

describe("executeRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(executeRevenueActionKeys.list()[0]).toBe("execute-revenue-action");
    expect(executeRevenueActionKeys.detail("abc")).toEqual([
      "execute-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(EXECUTE_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
