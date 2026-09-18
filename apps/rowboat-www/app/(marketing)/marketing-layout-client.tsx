"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { MarketingEffects } from "./marketing-effects";
import { SimLandingShell } from "./sim-landing/landing-shell";

/**
 * Shared Sim marketing chrome for every public route in `(marketing)`.
 * Homepage and inner pages share the scroll port, frosted header, painted CTA,
 * and footer; only section rhythm differs on `/`.
 */
export function MarketingLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <div
      className={cn(
        "sm-site sim-marketing-site relative flex flex-col marketing-polar app-vh-shell overflow-hidden",
        isHome && "sim-home-site",
      )}
    >
      <MarketingEffects />
      <SimLandingShell variant={isHome ? "home" : "subpage"}>{children}</SimLandingShell>
    </div>
  );
}
