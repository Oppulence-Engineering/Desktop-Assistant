"use client";

// Client for the Revenue Action Queue (RFC 030). Every call goes through the
// same-origin dashboard proxy, which attaches the rowboat-api bearer token
// server-side and bounces the browser back through WorkOS on a 401.

import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";
import type {
  RevenueAction,
  RevenueLeakScan,
  RevenuePolicyDecision,
  RevenueRelationship,
  RevenueWorkspace,
} from "@/types/revenue";

export class RevenueAPIError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RevenueAPIError";
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await dashboardFetch(toDashboardAPIPath(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      detail = body.detail || body.title || detail;
      code = body.code;
    } catch {
      // non-JSON error body; keep the status-based message
    }
    throw new RevenueAPIError(detail, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = (path: string, body?: unknown) =>
  call(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// --- workspace ---------------------------------------------------------------

export const getWorkspace = () => call<RevenueWorkspace>("/revenue-workspaces/current");

// --- scan --------------------------------------------------------------------

export const startScan = (lookbackDays?: number) =>
  post(
    "/revenue-leak-scans",
    lookbackDays ? { lookbackDays } : undefined,
  ) as Promise<RevenueLeakScan>;

export const getScan = (scanId: string) => call<RevenueLeakScan>(`/revenue-leak-scans/${scanId}`);

// --- queue reads -------------------------------------------------------------

export async function listActions(queueStatus = "open", limit = 25): Promise<RevenueAction[]> {
  const params = new URLSearchParams({ queueStatus, limit: String(limit) });
  const body = await call<{ actions: RevenueAction[] }>(`/revenue-actions?${params.toString()}`);
  return body.actions ?? [];
}

export const getAction = (actionId: string) => call<RevenueAction>(`/revenue-actions/${actionId}`);

export interface ActionAudit {
  action: RevenueAction;
  revisions: Array<Record<string, unknown>>;
  decisions: RevenuePolicyDecision[];
  outcomes: Array<Record<string, unknown>>;
}

export const getAudit = (actionId: string) =>
  call<ActionAudit>(`/revenue-actions/${actionId}/audit`);

export async function listRelationships(): Promise<RevenueRelationship[]> {
  const body = await call<{ relationships: RevenueRelationship[] }>("/relationships");
  return body.relationships ?? [];
}

// --- lifecycle ---------------------------------------------------------------

export interface EditActionInput {
  reason?: string;
  recipientEmail?: string;
  proposedSubject?: string;
  proposedMessage?: string;
  senderAccountRef?: string;
  channel?: string;
  actionType?: string;
  executionMode?: string;
}

export const editAction = (actionId: string, input: EditActionInput) =>
  post(`/revenue-actions/${actionId}/edit`, input) as Promise<RevenueAction>;

export const evaluateAction = (actionId: string) =>
  post(`/revenue-actions/${actionId}/evaluate`) as Promise<RevenuePolicyDecision>;

export const approveAction = (actionId: string, acceptRisk = false) =>
  post(`/revenue-actions/${actionId}/approve`, { acceptRisk }) as Promise<RevenueAction>;

export const rejectAction = (actionId: string, reason: string) =>
  post(`/revenue-actions/${actionId}/reject`, { reason }) as Promise<RevenueAction>;

export const executeAction = (actionId: string) =>
  post(`/revenue-actions/${actionId}/execute`) as Promise<RevenueAction>;

export const snoozeAction = (actionId: string, until: string) =>
  post(`/revenue-actions/${actionId}/snooze`, { until }) as Promise<RevenueAction>;

export const dismissAction = (actionId: string, reason: string) =>
  post(`/revenue-actions/${actionId}/dismiss`, { reason }) as Promise<RevenueAction>;

// --- display helpers ---------------------------------------------------------

export const DETECTOR_LABELS: Record<string, string> = {
  requested_follow_up_due: "Follow-up due",
  unanswered_proposal: "Unanswered proposal",
  waiting_on_me: "Waiting on you",
  dormant_warm_opportunity: "Dormant opportunity",
  neglected_referral: "Neglected referral",
  former_customer_reconnect: "Former customer",
  manual: "Manual",
};

export const ACTION_TYPE_LABELS: Record<string, string> = {
  warm_follow_up: "Warm follow-up",
  proposal_nudge: "Proposal nudge",
  referral_reconnect: "Referral reconnect",
  customer_risk: "Customer risk",
  meeting_follow_up: "Meeting follow-up",
};

export const PRIORITY_COMPONENT_LABELS: Record<string, string> = {
  relationship_value: "Relationship value",
  commitment_urgency: "Commitment urgency",
  recency_signal: "Recency",
  opportunity_signal: "Opportunity",
  evidence_quality: "Evidence quality",
  uncertainty_penalty: "Uncertainty",
  contact_risk_penalty: "Contact risk",
};

export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const day = 86_400_000;
  const past = diff >= 0;
  const fmt = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"} ${past ? "ago" : "from now"}`;
  if (abs < 3600_000) return fmt(Math.max(1, Math.round(abs / 60_000)), "min");
  if (abs < day) return fmt(Math.round(abs / 3600_000), "hour");
  if (abs < 30 * day) return fmt(Math.round(abs / day), "day");
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
