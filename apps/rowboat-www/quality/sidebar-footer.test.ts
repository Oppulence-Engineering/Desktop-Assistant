import { describe, expect, it } from "vitest";

import {
  connectedSourceCount,
  googleNeedsReconnect,
  revenueTabFromParam,
  revenueTabSearch,
  sourceHealth,
  trialDaysRemaining,
} from "@/components/app-shell";
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

  // The status card's meter reads "connected / total". A source that needs
  // reconnecting delivers nothing, so counting it would show a full meter over
  // a dead grant.
  it("does not count a source that stopped reporting as connected", () => {
    expect(
      connectedSourceCount([
        source(),
        source({ status: "reconnect_required" }),
        source({ status: "disconnected" }),
        source({ status: "backfilling", completeness: "partial" }),
      ]),
    ).toBe(2);
  });
});

describe("audit reconnect guard", () => {
  const google = (status: string, sourceAccountId = "me@x.co") =>
    ({ source: "google", sourceAccountId, status }) as RelationshipSourceStatus;

  it("sends the user to reconnect when every Google account stopped", () => {
    expect(googleNeedsReconnect([google("reconnect_required")])).toBe(true);
    expect(googleNeedsReconnect([google("disconnected"), google("reconnect_required", "b")])).toBe(
      true,
    );
  });

  // The desktop app can record a reconnect under "default" while the failed
  // row keeps the email. One working account means the audit can run.
  it("lets the audit run when any Google account works again", () => {
    expect(
      googleNeedsReconnect([google("reconnect_required"), google("connected", "default")]),
    ).toBe(false);
  });

  // With no rows the audit runs, fails if it must, and marks the real account.
  it("does not block when nothing is known about Google yet", () => {
    expect(googleNeedsReconnect([])).toBe(false);
    expect(
      googleNeedsReconnect([
        { source: "slack", status: "reconnect_required" } as RelationshipSourceStatus,
      ]),
    ).toBe(false);
  });
});

describe("revenue tab address", () => {
  it("round-trips every tab through the query string", () => {
    for (const tab of ["people", "queue", "scans", "workspace", "commitments"] as const) {
      const search = revenueTabSearch(tab);
      expect(revenueTabFromParam(new URLSearchParams(search).get("tab"))).toBe(tab);
    }
    expect(revenueTabSearch("commitments")).toBe("");
  });

  // A hand-edited or stale link must not render an empty view.
  it("falls back to Commitments for an unknown or inherited key", () => {
    expect(revenueTabFromParam("bogus")).toBe("commitments");
    expect(revenueTabFromParam("toString")).toBe("commitments");
    expect(revenueTabFromParam(null)).toBe("commitments");
  });
});
