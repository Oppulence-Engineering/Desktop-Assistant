"use client";

import { Suspense } from "react";

import { DevToolkit } from "@/components/dev/dev-toolkit";
import { RouteDevBadge } from "@/components/dev/route-dev-badge";

/**
 * Global dev-only overlays.
 *
 * These components are SSR-safe: browser APIs are isolated behind effects and
 * external stores provide server snapshots. Keeping them as ordinary client
 * components lets Next validate instant navigation without the synthetic
 * server-render error produced by `next/dynamic({ ssr: false })`.
 */
export function DevProviders({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  return (
    <>
      <Suspense fallback={null}>
        <RouteDevBadge />
      </Suspense>
      <Suspense fallback={null}>
        <DevToolkit />
      </Suspense>
    </>
  );
}
