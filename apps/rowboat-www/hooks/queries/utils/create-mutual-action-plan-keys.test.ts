import { describe, expect, it } from "vitest";

import {
  createMutualActionPlanKeys,
  CREATE_MUTUAL_ACTION_PLAN_STALE_TIME,
} from "./create-mutual-action-plan-keys";

describe("createMutualActionPlanKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(createMutualActionPlanKeys.list()[0]).toBe("create-mutual-action-plan");
    expect(createMutualActionPlanKeys.detail("abc")).toEqual([
      "create-mutual-action-plan",
      "detail",
      "abc",
      {},
    ]);
    expect(CREATE_MUTUAL_ACTION_PLAN_STALE_TIME).toBe(15_000);
  });
});
