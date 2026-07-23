"use client";

// Thin analytics wrapper around PostHog. Initializes lazily on the first
// capture, and only when NEXT_PUBLIC_POSTHOG_KEY is set — with no key it is a
// silent no-op, so the dashboard works identically in dev and in any env that
// hasn't configured analytics.

import posthog from "posthog-js";

let initialized = false;
let disabled = false;

function client(): typeof posthog | null {
  if (disabled) return null;
  if (initialized) return posthog;
  if (typeof window === "undefined") return null;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    disabled = true;
    return null;
  }
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false,
    autocapture: false,
    person_profiles: "identified_only",
  });
  initialized = true;
  return posthog;
}

/** capture emits one product event; a no-op when analytics is not configured. */
export function capture(event: string, props?: Record<string, unknown>): void {
  try {
    client()?.capture(event, props);
  } catch {
    // analytics must never break the app
  }
}

// Revenue funnel event names, kept in one place so they stay consistent.
export const RevenueEvents = {
  ScanStarted: "revenue_scan_started",
  ActionReviewed: "revenue_action_reviewed",
  ActionApproved: "revenue_action_approved",
  ActionExecuted: "revenue_action_executed",
  ActionDismissed: "revenue_action_dismissed",
  OutcomeLogged: "revenue_outcome_logged",
  WorkspaceLinked: "revenue_workspace_linked",
  UpgradeClicked: "revenue_upgrade_clicked",
} as const;

// RFC 023 closed-loop action broker events.
export const ActionEvents = {
  ProposalApproved: "action_proposal_approved",
  ProposalExecuted: "action_proposal_executed",
  ProposalRejected: "action_proposal_rejected",
  AuditViewed: "action_audit_viewed",
} as const;
