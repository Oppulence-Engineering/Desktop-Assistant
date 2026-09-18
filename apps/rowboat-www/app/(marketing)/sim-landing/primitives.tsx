import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/sim/cn";

import { SimChevronArrow } from "./chevron-arrow";
import { LANDING_STAGE_RADIUS, LANDING_WINDOW_SHADOW } from "./tokens";

type CtaSize = "compact" | "default" | "display";

const CTA_SIZE = {
  compact: "h-[26px] px-3 text-[13px] [--cta-arrow-icon-size:10px]",
  default: "h-9 px-4 text-[14px] [--cta-arrow-icon-size:12px]",
  display: "h-10 px-4 text-[14px] [--cta-arrow-icon-size:14px]",
} as const;

/** Sim `LandingCtaLink` geometry without ChipLink / PostHog dependencies. */
export function SimCtaLink({
  children,
  className,
  href,
  size = "default",
  variant = "primary",
  withArrow = false,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  size?: CtaSize;
  variant?: "primary" | "outline";
  withArrow?: boolean;
}) {
  return (
    <Link
      className={cn(
        "inline-flex items-center justify-center rounded-full text-center duration-150 transition-colors",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4",
        CTA_SIZE[size],
        withArrow && ["group/link", size === "compact" ? "gap-1.5 pr-2" : "gap-2"],
        variant === "primary"
          ? "bg-[var(--text-primary)] text-[var(--text-inverse)] hover:bg-[var(--text-body)]"
          : "border border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:border-[color-mix(in_srgb,var(--border)_80%,var(--text-secondary))]",
        className,
      )}
      href={href}
    >
      {children}
      {withArrow ? (
        <SimChevronArrow className="size-[var(--cta-arrow-icon-size)]" strokeWidth={1} />
      ) : null}
    </Link>
  );
}

export function SimHeroCta({ size = "display" }: { size?: CtaSize }) {
  return (
    <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      <SimCtaLink href="/product" size={size}>
        See how it works
      </SimCtaLink>
      <SimCtaLink href="/sign-up" size={size} variant="outline">
        Start for free
      </SimCtaLink>
    </div>
  );
}

/** Sim `PlacementFrame` grayscale product ground. */
export function SimPlacementFrame({
  className,
  tone,
}: {
  className?: string;
  tone: "light" | "mid" | "dark";
}) {
  const toneClass =
    tone === "light"
      ? "bg-[var(--surface-3)]"
      : tone === "mid"
        ? "bg-[var(--surface-5)]"
        : "bg-[var(--text-secondary)] dark:bg-[var(--surface-3)]";

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        LANDING_STAGE_RADIUS,
        toneClass,
        LANDING_WINDOW_SHADOW,
        className,
      )}
    />
  );
}
