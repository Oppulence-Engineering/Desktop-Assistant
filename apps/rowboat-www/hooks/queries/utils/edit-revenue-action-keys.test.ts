import { describe, expect, it } from "vitest";

import { editRevenueActionKeys, EDIT_REVENUE_ACTION_STALE_TIME } from "./edit-revenue-action-keys";

describe("editRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(editRevenueActionKeys.list()[0]).toBe("edit-revenue-action");
    expect(editRevenueActionKeys.detail("abc")).toEqual([
      "edit-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(EDIT_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
