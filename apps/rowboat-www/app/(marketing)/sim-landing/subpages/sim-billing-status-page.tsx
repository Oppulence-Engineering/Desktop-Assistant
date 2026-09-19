import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SIM_SURFACE_CARD } from "./sim-surface-card";
import { SimCtaLink } from "../primitives";

export type SimBillingAction = {
  href: string;
  label: string;
  variant?: "primary" | "outline";
};

/** Minimal Sim billing return page — cancel or success. */
export function SimBillingStatusPage({
  title,
  description,
  noteTitle,
  noteBody,
  actions,
}: {
  title: string;
  description: string;
  noteTitle: string;
  noteBody: string;
  actions: SimBillingAction[];
}) {
  return (
    <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <SimSubpageHero
          description={description}
          eyebrow="[billing]"
          title={title}
          titleId="billing-heading"
        />
      </div>

      <SimPageDivider />

      <SimBorderedColumn>
        <section className="px-6 py-10">
          <div className={cn(SIM_SURFACE_CARD, "flex flex-col gap-3 p-6")}>
            <h2 className="text-[18px] text-[var(--text-primary)] leading-[1.2]">{noteTitle}</h2>
            <p className="text-[15px] text-[var(--text-secondary)] leading-[1.55]">{noteBody}</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            {actions.map((action) => (
              <SimCtaLink
                href={action.href}
                key={action.href}
                variant={action.variant ?? "primary"}
              >
                {action.label}
              </SimCtaLink>
            ))}
          </div>
        </section>
      </SimBorderedColumn>

      <SimPageFooterRule />
    </div>
  );
}
