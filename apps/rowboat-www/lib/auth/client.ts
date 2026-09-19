"use client";

import "client-only";

import {
  dashboardRequest,
  loginURL,
  redirectBrowserIfUnauthorized,
  toDashboardAPIPath,
} from "@/lib/auth/dashboard-fetch";
import { BrowserSessionResponseSchema, type BrowserSessionResponse } from "@/lib/auth/schemas";

export { loginURL, toDashboardAPIPath };

/** Thrown when WorkOS refresh is temporarily unreachable but cookies may still be valid. */
export class SessionUnavailableError extends Error {
  constructor() {
    super("session refresh is temporarily unavailable");
    this.name = "SessionUnavailableError";
  }
}

/**
 * Loads the current browser session from the server-side auth boundary. The
 * response contains display/onboarding data only; WorkOS tokens stay in
 * HTTP-only cookies and are never exposed to client components.
 */
export async function loadBrowserSession(): Promise<BrowserSessionResponse> {
  const res = await fetch("/api/auth/session", {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) return { authenticated: false };
  if (res.status === 502 || res.status === 503) throw new SessionUnavailableError();
  if (!res.ok) throw new Error(`Session check failed: ${res.status}`);
  return BrowserSessionResponseSchema.parse(await res.json());
}

/**
 * Browser dashboard fetch. Adds the login bounce that Server Components
 * cannot perform. Prefer `requestJson` for new validated JSON reads.
 */
export async function dashboardFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await dashboardRequest(input, init);
  redirectBrowserIfUnauthorized(res.status);
  return res;
}
