import type { ReactNode } from "react";

import { cn } from "@/lib/sim/cn";

import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";

/** Shared Sim subpage hero — comparisons / library heading rhythm. */
export function SimSubpageHero({
  eyebrow,
  title,
  description,
  children,
  titleId = "subpage-heading",
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">{eyebrow}</p>
      <h1
        className="text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]"
        id={titleId}
      >
        {title}
      </h1>
      {description ? (
        <p className="max-w-[720px] text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** Bordered content column used on catalog, compare, and editorial pages. */
export function SimBorderedColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, className)}>
      <div className="border-[var(--border)] border-x">{children}</div>
    </div>
  );
}

export function SimPageDivider() {
  return <div className="mt-8 h-px w-full bg-[var(--border)]" />;
}

export function SimPageFooterRule() {
  return <div className="-mt-px h-px w-full bg-[var(--border)]" />;
}
