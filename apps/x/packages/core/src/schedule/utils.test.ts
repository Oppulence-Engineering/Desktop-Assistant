import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dueTimedTrigger } from "./utils.js";

describe("dueTimedTrigger cron cycles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire a never-run task outside its scheduled occurrence", () => {
    // Task created at 8:58pm with an 8am-weekdays cron: nothing is due.
    vi.setSystemTime(new Date("2026-06-11T20:58:00")); // Thursday evening
    expect(dueTimedTrigger({ cronExpr: "0 8 * * 1-5" }, null)).toBeNull();
  });

  it("fires a never-run task within the grace window of an occurrence", () => {
    vi.setSystemTime(new Date("2026-06-11T08:01:00")); // Thursday 8:01am
    expect(dueTimedTrigger({ cronExpr: "0 8 * * 1-5" }, null)).toBe("cron");
  });

  it("skips an occurrence the task already ran for", () => {
    vi.setSystemTime(new Date("2026-06-11T08:01:00"));
    expect(dueTimedTrigger({ cronExpr: "0 8 * * 1-5" }, "2026-06-11T08:00:30")).toBeNull();
  });

  it("fires a fresh occurrence after an older successful run", () => {
    vi.setSystemTime(new Date("2026-06-11T08:01:00"));
    expect(dueTimedTrigger({ cronExpr: "0 8 * * 1-5" }, "2026-06-10T08:00:30")).toBe("cron");
  });

  it("treats an occurrence missed beyond grace as skipped", () => {
    vi.setSystemTime(new Date("2026-06-11T08:05:00")); // grace is 2 minutes
    expect(dueTimedTrigger({ cronExpr: "0 8 * * 1-5" }, "2026-06-10T08:00:30")).toBeNull();
  });
});
