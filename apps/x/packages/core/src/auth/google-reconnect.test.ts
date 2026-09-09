import { describe, expect, it } from "vitest";

import { hasGoogleCredentialChanged } from "./google-reconnect.js";

describe("hasGoogleCredentialChanged", () => {
  it("does not treat the stale credential present before reconnect as completion", () => {
    expect(hasGoogleCredentialChanged("stale-token", "stale-token")).toBe(false);
  });

  it("detects a newly claimed credential after reconnect", () => {
    expect(hasGoogleCredentialChanged("stale-token", "new-token")).toBe(true);
  });

  it("detects the first credential for a new connection", () => {
    expect(hasGoogleCredentialChanged(null, "new-token")).toBe(true);
  });

  it("does not report completion while no credential exists", () => {
    expect(hasGoogleCredentialChanged(null, null)).toBe(false);
  });
});
