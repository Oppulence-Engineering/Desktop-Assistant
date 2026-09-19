"use client";

import { useEffect, useState, type ComponentType } from "react";

import { isDevelopment } from "@/lib/environment";

type QueryDevtools = ComponentType<{
  initialIsOpen?: boolean;
  buttonPosition?: "bottom-left" | "bottom-right" | "top-left" | "top-right";
}>;

/**
 * TanStack Query inspector — product routes only, development builds.
 *
 * Loaded after mount so Next can validate instant navigation. `next/dynamic({
 * ssr: false })` bails out of the server render and Next reports that as a
 * hard "/app" crash even when `instant` is already false.
 */
export function QueryDevtoolsPanel() {
  const [Devtools, setDevtools] = useState<QueryDevtools | null>(null);

  useEffect(() => {
    if (!isDevelopment()) return;
    let cancelled = false;
    void import("@tanstack/react-query-devtools").then((mod) => {
      if (!cancelled) setDevtools(() => mod.ReactQueryDevtools);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Devtools) return null;
  return <Devtools initialIsOpen={false} buttonPosition="bottom-left" />;
}
