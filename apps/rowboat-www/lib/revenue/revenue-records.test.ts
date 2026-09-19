import { describe, expect, it } from "vitest";

import { mapSettledWithConcurrency } from "@/lib/revenue/revenue-records";

describe("mapSettledWithConcurrency", () => {
  it("bounds fan-out, preserves order, and retains partial failures", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const work = mapSettledWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      if (value === 3) throw new Error("timeline unavailable");
      return value * 10;
    });

    while (releases.length < 2) await Promise.resolve();
    releases.shift()?.();
    while (releases.length < 2) await Promise.resolve();
    releases.shift()?.();
    while (releases.length < 2) await Promise.resolve();
    releases.shift()?.();
    while (releases.length < 2) await Promise.resolve();
    releases.shift()?.();
    while (releases.length < 1) await Promise.resolve();
    releases.shift()?.();

    const results = await work;
    expect(maxActive).toBe(2);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[4]).toEqual({ status: "fulfilled", value: 50 });
  });

  it("rejects an invalid concurrency limit before starting work", async () => {
    await expect(
      mapSettledWithConcurrency([1], 0, (value) => Promise.resolve(value)),
    ).rejects.toThrow("positive integer");
  });
});
