import { describe, expect, it } from "vitest";

import {
  shareMutualActionPlanKeys,
  SHARE_MUTUAL_ACTION_PLAN_STALE_TIME,
} from "./share-mutual-action-plan-keys";

describe("shareMutualActionPlanKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(shareMutualActionPlanKeys.list()[0]).toBe("share-mutual-action-plan");
    expect(shareMutualActionPlanKeys.detail("abc")).toEqual([
      "share-mutual-action-plan",
      "detail",
      "abc",
      {},
    ]);
    expect(SHARE_MUTUAL_ACTION_PLAN_STALE_TIME).toBe(15_000);
  });
});
