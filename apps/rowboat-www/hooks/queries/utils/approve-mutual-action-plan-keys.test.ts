import { describe, expect, it } from "vitest";

import {
  approveMutualActionPlanKeys,
  APPROVE_MUTUAL_ACTION_PLAN_STALE_TIME,
} from "./approve-mutual-action-plan-keys";

describe("approveMutualActionPlanKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(approveMutualActionPlanKeys.list()[0]).toBe("approve-mutual-action-plan");
    expect(approveMutualActionPlanKeys.detail("abc")).toEqual([
      "approve-mutual-action-plan",
      "detail",
      "abc",
      {},
    ]);
    expect(APPROVE_MUTUAL_ACTION_PLAN_STALE_TIME).toBe(15_000);
  });
});
