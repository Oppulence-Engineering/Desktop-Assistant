"use client";

import "client-only";

// Thin analytics wrapper around PostHog. Initializes lazily on the first
// capture, and only when NEXT_PUBLIC_POSTHOG_KEY is set — with no key it is a
// silent no-op, so the dashboard works identically in dev and in any env that
// hasn't configured analytics.

import posthog from "posthog-js";

import { getConsolePreferences } from "@/lib/console";

let initialized = false;
let disabled = false;
let consent: boolean | undefined;
let consentRequest: Promise<boolean> | undefined;

const SENSITIVE_PROPERTY =
  /(?:id$|email|name|message|content|query|title|prompt|relationship|commitment)/i;

function safeProperties(
  props?: Record<string, unknown>,
): Record<string, string | number | boolean> {
  if (!props) return {};
  return Object.fromEntries(
    Object.entries(props).filter(
      ([key, value]) =>
        !SENSITIVE_PROPERTY.test(key) &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
    ),
  ) as Record<string, string | number | boolean>;
}

async function hasConsent(): Promise<boolean> {
  if (consent !== undefined) return consent;
  consentRequest ??= getConsolePreferences()
    .then((preferences) => {
      consent = preferences.shareUsageData;
      return consent;
    })
    .catch(() => false);
  return consentRequest;
}

/** Keeps capture gating current immediately after the preference is patched. */
export function setAnalyticsConsent(next: boolean): void {
  consent = next;
  consentRequest = Promise.resolve(next);
  if (initialized) {
    if (next) posthog.opt_in_capturing();
    else posthog.opt_out_capturing();
  }
}

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

/** Captures only after synced consent resolves true; failures remain no-ops. */
export function capture(event: string, props?: Record<string, unknown>): void {
  void hasConsent().then((allowed) => {
    if (!allowed) return;
    const sanitized = safeProperties(props);
    try {
      client()?.capture(event, sanitized);
    } catch {
      // analytics must never break the app
    }
  });
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
  // The strongest available signal that the ledger is believed: a record was
  // taken out of the tool and into a real conversation (one-pager §18).
  CommitmentExported: "revenue_commitment_exported",
  RegisterViewed: "revenue_register_viewed",
  ReportViewed: "revenue_open_promises_report_viewed",
  UpgradeClicked: "revenue_upgrade_clicked",
} as const;

// RFC 023 closed-loop action broker events.
export const ActionEvents = {
  ProposalApproved: "action_proposal_approved",
  ProposalExecuted: "action_proposal_executed",
  ProposalRejected: "action_proposal_rejected",
  AuditViewed: "action_audit_viewed",
} as const;
