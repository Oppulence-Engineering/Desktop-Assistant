"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";

import { Badge } from "@oppulence/ui/components/badge";
import { getDevPrefs, subscribeDevPrefs } from "@/lib/dev/dev-prefs";

function useDevPrefsEnabled(key: "routeBadge") {
  return useSyncExternalStore(
    subscribeDevPrefs,
    () => getDevPrefs()[key],
    () => true,
  );
}

/** Top-right route context chip for App Router debugging. */
export function RouteDevBadge() {
  const enabled = useDevPrefsEnabled("routeBadge");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!enabled) return null;

  const query = searchParams.toString();
  const segment = pathname.startsWith("/app")
    ? "product"
    : pathname.startsWith("/sign-")
      ? "auth"
      : "marketing";

  return (
    <div
      aria-label="Route debug badge"
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 9997,
        maxWidth: "min(420px, 90vw)",
        borderRadius: 8,
        border: "1px solid color-mix(in oklab, var(--foreground) 14%, transparent)",
        background: "color-mix(in oklab, var(--background) 88%, transparent)",
        backdropFilter: "blur(8px)",
        padding: "6px 10px",
        fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
        fontSize: 10,
        lineHeight: 1.45,
        color: "var(--foreground)",
        pointerEvents: "none",
      }}
    >
      <div>
        <Badge
          className="rounded-none border-0 bg-transparent p-0 font-normal opacity-55 shadow-none"
          variant="outline"
        >
          {segment}
        </Badge>
        {" · "}
        {pathname}
        {query ? `?${query}` : ""}
      </div>
    </div>
  );
}
