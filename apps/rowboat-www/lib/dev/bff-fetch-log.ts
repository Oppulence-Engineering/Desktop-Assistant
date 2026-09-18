/**
 * Dev-only fetch instrumentation for same-origin BFF routes.
 *
 * Patches `window.fetch` once so product engineers can see proxy latency,
 * status codes, and auth refresh behavior without opening Network tab filters.
 */

import { z } from "zod";

import { isDevelopment } from "@/lib/environment";

export type BffRequestEntry = {
  id: string;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  requestId?: string;
  errorCode?: string;
};

/** Same-origin API prefixes the dashboard and auth flows hit through Next.js. */
export const BFF_FETCH_PREFIXES = ["/api/rowboat", "/api/auth", "/api/support"] as const;

const MAX_ENTRIES = 50;
const BffErrorBodySchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
});

let entries: BffRequestEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function getBffFetchLog(): readonly BffRequestEntry[] {
  return entries;
}

export function subscribeBffFetchLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearBffFetchLog(): void {
  entries = [];
  notify();
}

export function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isBffRequest(url: string): boolean {
  try {
    const pathname = url.startsWith("http") ? new URL(url).pathname : (url.split("?")[0] ?? url);
    return BFF_FETCH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  } catch {
    return BFF_FETCH_PREFIXES.some((prefix) => url.includes(prefix));
  }
}

type FetchLike = typeof fetch;

declare global {
  interface Window {
    __oppulenceBffFetchPatched?: boolean;
  }
}

/**
 * Wrap fetch to record BFF calls. Safe to call multiple times; only the first
 * call installs the patch.
 */
export function installBffFetchInstrumentation(fetchImpl: FetchLike = fetch): FetchLike {
  if (typeof window === "undefined") return fetchImpl;
  if (window.__oppulenceBffFetchPatched) return window.fetch.bind(window);

  const original = fetchImpl.bind(window);

  window.fetch = async (input, init) => {
    const url = resolveRequestUrl(input);
    if (!isBffRequest(url)) {
      return original(input, init);
    }

    const id = crypto.randomUUID();
    const startedAt = performance.now();
    const method = (init?.method ?? "GET").toUpperCase();

    entries = [{ id, method, url, startedAt }, ...entries].slice(0, MAX_ENTRIES);
    notify();

    try {
      const response = await original(input, init);
      const finishedAt = performance.now();
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-correlation-id") ??
        undefined;
      let errorCode: string | undefined;
      if (response.status >= 400) {
        try {
          const clone = response.clone();
          const body = BffErrorBodySchema.safeParse(await clone.json());
          if (body.success) {
            errorCode = body.data.code ?? body.data.error;
          }
        } catch {
          // non-JSON error bodies are fine
        }
      }
      entries = entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: response.status,
              durationMs: finishedAt - startedAt,
              finishedAt,
              requestId,
              errorCode,
            }
          : entry,
      );
      notify();
      if (isDevelopment()) {
        void import("@/lib/dev/bff-error-toast").then(({ maybeToastBffError }) => {
          maybeToastBffError(url, response.status, errorCode);
        });
      }
      return response;
    } catch (error) {
      const finishedAt = performance.now();
      entries = entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: 0,
              durationMs: finishedAt - startedAt,
              finishedAt,
              error: error instanceof Error ? error.message : "fetch failed",
            }
          : entry,
      );
      notify();
      throw error;
    }
  };

  window.__oppulenceBffFetchPatched = true;
  return window.fetch;
}
