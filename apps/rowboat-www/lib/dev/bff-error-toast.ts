"use client";

import { toast } from "sonner";

const SHOWN = new Set<string>();

/** Dev-only actionable toast when a BFF response returns a structured error. */
export function maybeToastBffError(url: string, status: number, errorCode?: string) {
  if (typeof window === "undefined") return;
  if (status < 400) return;

  const key = `${status}:${errorCode ?? url}`;
  if (SHOWN.has(key)) return;
  SHOWN.add(key);

  const hint =
    status === 401 || errorCode === "session_unavailable"
      ? "Try Dev toolkit → Session → Refresh, or sign in again."
      : status === 502 || status === 503
        ? "Check rowboat-api is running (npm run dev:stack prints health)."
        : "See Dev toolkit → API tab for request-id and latency.";

  toast.error(`BFF ${status}${errorCode ? ` (${errorCode})` : ""}`, {
    description: `${url}\n${hint}`,
    duration: 8_000,
  });
}
