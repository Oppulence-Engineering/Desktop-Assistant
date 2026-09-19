import { describe, expect, it } from "vitest";

import {
  createRevenueActionKeys,
  CREATE_REVENUE_ACTION_STALE_TIME,
} from "./create-revenue-action-keys";

describe("createRevenueActionKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(createRevenueActionKeys.list()[0]).toBe("create-revenue-action");
    expect(createRevenueActionKeys.detail("abc")).toEqual([
      "create-revenue-action",
      "detail",
      "abc",
      {},
    ]);
    expect(CREATE_REVENUE_ACTION_STALE_TIME).toBe(15_000);
  });
});
