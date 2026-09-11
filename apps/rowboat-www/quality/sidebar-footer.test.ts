import { describe, expect, it } from "vitest";

import { sourceHealth, trialDaysRemaining } from "@/components/app-shell";
import type { RelationshipSourceStatus } from "@/types/revenue";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("sidebar trial banner", () => {
  it("counts the whole days left on a trial", () => {
    expect(trialDaysRemaining({ status: "trialing", trialExpiresAt: inDays(28.5) })).toBe(29);
  });

  it("stays silent for every account that is not trialing", () => {
    // A paid account keeps the date of the trial it converted from. Reading the
    // date without the status would put a trial banner on a paying customer.
    expect(trialDaysRemaining({ status: "active", trialExpiresAt: inDays(28) })).toBeNull();
    expect(trialDaysRemaining({ status: "trialing", trialExpiresAt: null })).toBeNull();
    expect(trialDaysRemaining(undefined)).toBeNull();
  });

  it("never counts below zero once the trial has expired", () => {
    expect(trialDaysRemaining({ status: "trialing", trialExpiresAt: inDays(-3) })).toBe(0);
  });
});

describe("sidebar source status", () => {
  const source = (over: Partial<RelationshipSourceStatus> = {}) =>
    ({ status: "streaming", completeness: "complete", ...over }) as RelationshipSourceStatus;

  it("says nothing is connected when no source reports", () => {
    expect(sourceHealth([]).tone).toBe("idle");
  });

  it("reports a healthy portfolio of sources", () => {
    expect(sourceHealth([source(), source()])).toEqual({
      tone: "ok",
      label: "Sources are current",
    });
  });

  // A source that stopped reporting hides risk rather than showing it, so it
  // must win over a source that is merely still catching up.
  it("ranks a disconnected source above one that is only syncing", () => {
    const health = sourceHealth([
      source({ status: "backfilling", completeness: "partial" }),
      source({ status: "reconnect_required" }),
    ]);
    expect(health).toEqual({ tone: "attention", label: "1 source needs reconnecting" });
  });

  it("counts sources that are behind", () => {
    expect(
      sourceHealth([source({ status: "stale" }), source({ completeness: "partial" })]),
    ).toEqual({ tone: "attention", label: "2 sources are behind" });
  });
});
