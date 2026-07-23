"use client";

// Client for the RFC 023 closed-loop action broker. Every call goes through the
// same-origin dashboard proxy, which attaches the rowboat-api bearer token
// server-side and bounces the browser back through WorkOS on a 401. Mirrors
// lib/revenue.ts.

import { dashboardFetch, toDashboardAPIPath } from "@/lib/auth/client";
import type { ActionProposal, ApproveResult, AuditChain } from "@/types/actions";

export class ActionAPIError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ActionAPIError";
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
    throw new ActionAPIError(detail, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = (path: string, body?: unknown) =>
  call(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** The operator's pending action proposals awaiting approval. */
export const listPending = () =>
  call<{ proposals: ActionProposal[] }>("/action-proposals?status=pending").then(
    (r) => r.proposals,
  );

export const getProposal = (id: string) => call<ActionProposal>(`/action-proposals/${id}`);

/** Approve a pending proposal — issues the single-use token (returned once). */
export const approve = (id: string) =>
  post(`/action-proposals/${id}/approve`) as Promise<ApproveResult>;

export const reject = (id: string, reason: string) =>
  post(`/action-proposals/${id}/reject`, { reason }) as Promise<ActionProposal>;

/** Execute an approved proposal with the token from approve(). */
export const execute = (id: string, token: string) =>
  post(`/action-proposals/${id}/execute`, { token }) as Promise<ActionProposal>;

/** The full proposal → token → execution → return-event chain for one object. */
export const getAudit = (resourceRef: string) =>
  call<AuditChain>(`/objects/${encodeURIComponent(resourceRef)}/audit`);
