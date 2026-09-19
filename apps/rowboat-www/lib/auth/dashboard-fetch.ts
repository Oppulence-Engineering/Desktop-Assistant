/**
 * Same-origin dashboard HTTP primitives that Server Components can import.
 *
 * The 401 → login redirect is browser-only. Server prefetch talks to Go
 * directly and must not pull `client-only` into the RSC graph.
 */

export const DASHBOARD_REQUEST_TIMEOUT_MS = 30_000;

export function toDashboardAPIPath(path: string): string {
  if (path.startsWith("/api/")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/api/rowboat/v1${normalized}`;
}

export function loginURL(returnTo = "/app"): string {
  const params = new URLSearchParams({ return_to: returnTo });
  return `/api/auth/workos/login?${params.toString()}`;
}

/** No-op on the server so fetchers stay isomorphic. */
export function redirectBrowserIfUnauthorized(status: number): void {
  if (status !== 401 || typeof window === "undefined") return;
  window.location.assign(loginURL(window.location.pathname + window.location.search));
}

export type DashboardRequestInit = RequestInit & {
  timeoutMs?: number;
};

/**
 * Authenticated dashboard fetch without a client-module boundary.
 * Callers that need a login bounce should invoke
 * {@link redirectBrowserIfUnauthorized} after reading the status.
 */
export async function dashboardRequest(
  input: RequestInfo | URL,
  init?: DashboardRequestInit,
): Promise<Response> {
  const { timeoutMs = DASHBOARD_REQUEST_TIMEOUT_MS, ...requestInit } = init ?? {};
  return fetch(input, {
    ...requestInit,
    credentials: "include",
    signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
    headers: {
      ...(requestInit.headers || {}),
    },
  });
}
