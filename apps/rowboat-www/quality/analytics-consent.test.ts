// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  getConsolePreferences: vi.fn(),
  init: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
}));

vi.mock("@/lib/console", () => ({
  getConsolePreferences: mocks.getConsolePreferences,
}));
vi.mock("posthog-js", () => ({
  default: {
    capture: mocks.capture,
    init: mocks.init,
    opt_in_capturing: mocks.optIn,
    opt_out_capturing: mocks.optOut,
  },
}));

describe("analytics consent", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "ph_test";
  });

  it("does not initialize or capture without synced consent", async () => {
    mocks.getConsolePreferences.mockResolvedValue({
      defaultAgentSlug: "",
      displayName: "",
      shareUsageData: false,
    });
    const { capture } = await import("@/lib/analytics");

    capture("viewed", { surface: "report" });
    await vi.waitFor(() => {
      expect(mocks.getConsolePreferences).toHaveBeenCalledOnce();
    });

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("drops sensitive and structured properties before capture", async () => {
    mocks.getConsolePreferences.mockResolvedValue({
      defaultAgentSlug: "",
      displayName: "",
      shareUsageData: true,
    });
    const { capture } = await import("@/lib/analytics");

    capture("exported", {
      commitmentId: "secret-id",
      message: "customer content",
      surface: "report",
      count: 2,
      nested: { unsafe: true },
    });
    await vi.waitFor(() => {
      expect(mocks.capture).toHaveBeenCalledOnce();
    });

    expect(mocks.capture).toHaveBeenCalledWith("exported", {
      surface: "report",
      count: 2,
    });
  });
});
