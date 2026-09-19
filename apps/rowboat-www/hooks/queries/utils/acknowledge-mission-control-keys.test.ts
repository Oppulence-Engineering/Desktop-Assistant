import { describe, expect, it } from "vitest";

import {
  acknowledgeMissionControlKeys,
  ACKNOWLEDGE_MISSION_CONTROL_STALE_TIME,
} from "./acknowledge-mission-control-keys";

describe("acknowledgeMissionControlKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(acknowledgeMissionControlKeys.list()[0]).toBe("acknowledge-mission-control");
    expect(acknowledgeMissionControlKeys.detail("abc")).toEqual([
      "acknowledge-mission-control",
      "detail",
      "abc",
      {},
    ]);
    expect(ACKNOWLEDGE_MISSION_CONTROL_STALE_TIME).toBe(15_000);
  });
});
