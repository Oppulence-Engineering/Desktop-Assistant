"use client";

import { BrowserSessionResponseSchema, type BrowserSessionResponse } from "@/lib/auth/schemas";

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
  });
  if (res.status === 401) return { authenticated: false };
  if (!res.ok) throw new Error(`Session check failed: ${res.status}`);
  return BrowserSessionResponseSchema.parse(await res.json());
}

export function loginURL(returnTo = "/app"): string {
  const params = new URLSearchParams({ return_to: returnTo });
  return `/api/auth/workos/login?${params.toString()}`;
}

/**
 * Fetch wrapper for protected dashboard endpoints. It keeps every dashboard
 * request same-origin so the Next proxy can attach the rowboat-api bearer token
 * server-side and redirect the browser back through WorkOS when the session
 * expires.
 */
export async function dashboardFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.assign(loginURL(window.location.pathname + window.location.search));
  }
  return res;
}

export function toDashboardAPIPath(path: string): string {
  if (path.startsWith("/api/")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/api/rowboat/v1${normalized}`;
}
