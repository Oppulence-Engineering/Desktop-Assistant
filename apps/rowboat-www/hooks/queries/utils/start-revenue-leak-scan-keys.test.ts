import { describe, expect, it } from "vitest";

import {
  startRevenueLeakScanKeys,
  START_REVENUE_LEAK_SCAN_STALE_TIME,
} from "./start-revenue-leak-scan-keys";

describe("startRevenueLeakScanKeys", () => {
  it("nests list and detail keys under the resource root", () => {
    expect(startRevenueLeakScanKeys.list()[0]).toBe("start-revenue-leak-scan");
    expect(startRevenueLeakScanKeys.detail("abc")).toEqual([
      "start-revenue-leak-scan",
      "detail",
      "abc",
      {},
    ]);
    expect(START_REVENUE_LEAK_SCAN_STALE_TIME).toBe(15_000);
  });
});
