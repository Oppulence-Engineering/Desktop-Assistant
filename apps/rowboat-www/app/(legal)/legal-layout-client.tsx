"use client";

import { cn } from "@/lib/utils";

import { MarketingEffects } from "@/app/(marketing)/marketing-effects";
import { SimLandingShell } from "@/app/(marketing)/sim-landing/landing-shell";

/**
 * Legal routes share the marketing Sim scroll port so long documents scroll
 * inside `.sim-landing-scroll-port` instead of fighting body zoom + svh.
 */
export function LegalLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "sm-site sim-marketing-site relative flex flex-col marketing-polar app-vh-shell overflow-hidden",
      )}
    >
      <MarketingEffects />
      <SimLandingShell showClosingCta={false} variant="subpage">
        {children}
      </SimLandingShell>
    </div>
  );
}
