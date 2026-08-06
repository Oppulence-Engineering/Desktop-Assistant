import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The usage-data setting has to actually stop analytics.
 *
 * It previously lived in renderer `localStorage`, which the main process cannot
 * read, so nothing consulted it: a person who turned it off was told their
 * telemetry stopped and it did not. That is the one failure mode of a consent
 * control that matters, and it is invisible — the switch moves, the label
 * changes, and events keep shipping.
 *
 * These assert the two properties that make the fix real: every path that can
 * send is gated, and the gate is closed until consent has been read.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const posthogSource = fs.readFileSync(path.join(here, "posthog.ts"), "utf8");

describe("analytics consent gate", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("is off until the stored preference is applied", async () => {
    // Fail-closed. A wiring path that forgets to apply consent should send
    // nothing, not everything.
    const { isAnalyticsEnabled } = await import("./posthog.js");
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("turns on and off through setAnalyticsEnabled", async () => {
    const { isAnalyticsEnabled, setAnalyticsEnabled } = await import("./posthog.js");
    setAnalyticsEnabled(true);
    expect(isAnalyticsEnabled()).toBe(true);
    setAnalyticsEnabled(false);
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("checks consent before constructing the client, not just before capturing", () => {
    // Building the PostHog client issues an identify() of its own, so a gate
    // that only guarded capture() would still phone home for an opted-out user
    // the moment anything touched analytics.
    const getClientAt = posthogSource.indexOf("function getClient()");
    expect(getClientAt).toBeGreaterThan(-1);
    const body = posthogSource.slice(getClientAt, posthogSource.indexOf("\n}", getClientAt));
    const gateAt = body.indexOf("if (!analyticsEnabled) return null;");
    const initAt = body.indexOf("initAttempted = true;");
    expect(gateAt, "getClient must check consent").toBeGreaterThan(-1);
    expect(gateAt, "the consent check must precede initialisation").toBeLessThan(initAt);
  });

  it("routes every sending entry point through the gate", () => {
    // reset() is excluded deliberately: it only clears a local id and sends
    // nothing.
    for (const fn of ["capture", "identify", "captureException", "captureNativeCrash"]) {
      const at = posthogSource.indexOf(`export function ${fn}(`);
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      const body = posthogSource.slice(at, posthogSource.indexOf("\n}", at));
      expect(body, `${fn} must obtain its client via getClient()`).toContain("getClient()");
    }
  });

  it("does not read the preference from renderer localStorage", () => {
    // The original bug. The main process cannot see it, so a value stored there
    // can never gate anything. Matched on real API use rather than the word,
    // which appears in the comment explaining this history.
    expect(posthogSource).not.toMatch(/localStorage\s*\.\s*(get|set)Item/);
  });
});
