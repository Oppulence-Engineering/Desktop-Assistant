import type { ReactNode } from "react";

import { cn } from "@/lib/sim/cn";

import { HOME_INSET, LANDING_GUTTER } from "../../tokens";
import { SimCtaLink, SimHeroCta } from "../../primitives";
import { EdgeFade } from "../../edge-fade";
import type { SolutionsProductFeatureConfig } from "./types";

interface ProductShowcaseProps {
  feature: SolutionsProductFeatureConfig;
  description: ReactNode;
}

/**
 * Split introduction and broad product scene — ported from sim.ai `ProductShowcase`.
 * Native scroll areas chain vertically; portaled menus retain their own containment.
 */
export function ProductShowcase({ feature, description }: ProductShowcaseProps) {
  return (
    <section aria-labelledby={`${feature.id}-heading`} className="scroll-mt-24" id={feature.id}>
      <div className={LANDING_GUTTER}>
        <div
          className={cn(
            HOME_INSET,
            "grid grid-cols-2 gap-16 pt-24 max-sm:gap-5 max-sm:pt-12 max-md:grid-cols-1 max-lg:gap-10 max-lg:pt-20",
            feature.visualSize === "compact"
              ? "pb-16 max-sm:pb-8 max-lg:pb-12"
              : "pb-24 max-sm:pb-12 max-lg:pb-20",
          )}
        >
          <h2
            className="max-w-[18ch] text-balance font-normal text-[48px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.025em] max-sm:text-[32px] max-lg:text-[40px]"
            id={`${feature.id}-heading`}
          >
            {feature.title}
          </h2>
          <div>
            <p className="max-w-[36ch] text-balance text-[24px] text-[var(--text-body)] leading-[1.4] max-sm:text-[18px] max-lg:text-[20px]">
              {description}
            </p>
            <div className="mt-7">
              <SimHeroCta size="default" />
            </div>
          </div>
        </div>
      </div>
      <div
        className={cn(
          "relative isolate mx-3 overflow-hidden bg-[var(--bg)] [container-type:inline-size] max-sm:mx-0 [&_*]:overscroll-y-auto",
          feature.visualSize === "compact"
            ? "h-[560px] max-sm:h-[420px] max-lg:h-[480px]"
            : "h-[680px] max-sm:h-[500px] max-lg:h-[560px]",
        )}
        data-product-feature-visual={feature.id}
      >
        <div className="relative size-full">{feature.visual}</div>
        <EdgeFade depth="stage" edges={["bottom"]} ground="canvas" />
      </div>
      <div className={LANDING_GUTTER}>
        <div className={cn(HOME_INSET, "pt-5 pb-10 max-sm:pt-2 max-sm:pb-7")}>
          <p className="text-[15px] text-[var(--text-primary)] leading-6">{feature.label}</p>
          <p className="mt-1 max-w-[56ch] text-balance text-[15px] text-[var(--text-secondary)] leading-6">
            {feature.description}
          </p>
          {feature.cta ? (
            <div className="mt-4">
              <SimCtaLink className="max-w-full" href={feature.cta.href} variant="outline" withArrow>
                {feature.cta.label}
              </SimCtaLink>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
