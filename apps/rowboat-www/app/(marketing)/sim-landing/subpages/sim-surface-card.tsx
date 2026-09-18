import type { ReactNode } from "react";

import { cn } from "@/lib/sim/cn";

/** Sim card chrome — `PricingCard` / contact panel border + surface tokens. */
export const SIM_SURFACE_CARD =
  "rounded-lg border border-[var(--border)] bg-[var(--surface-2)] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_2px_6px_0_rgba(0,0,0,0.04)]";

export function SimSurfaceCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(SIM_SURFACE_CARD, className)}>{children}</div>;
}
