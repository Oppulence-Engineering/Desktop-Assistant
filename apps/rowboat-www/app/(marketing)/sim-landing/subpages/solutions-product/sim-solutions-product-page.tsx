import { cn } from "@/lib/sim/cn";

import { HOME_INSET, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../../tokens";
import { ProductFeature } from "./product-feature";
import { ProductShowcase } from "./product-showcase";
import type { SolutionsProductPageConfig } from "./types";

interface SimSolutionsProductPageProps {
  config: SolutionsProductPageConfig;
}

/**
 * Wide product page shell — ported from sim.ai `SolutionsProductPage`.
 * Hero visual, split showcase, and two-up feature grid share Sim spacing tokens.
 */
export function SimSolutionsProductPage({ config }: SimSolutionsProductPageProps) {
  const [showcase, ...features] = config.features;

  return (
    <main className={LANDING_CONTENT_WIDTH} id="main-content">
      <section
        aria-labelledby="product-heading"
        className="border-[var(--border)] border-b pb-24 max-sm:pb-14 max-lg:pb-20"
      >
        <div className="px-3 max-sm:px-0">{config.hero.visual}</div>
        <div className={LANDING_GUTTER}>
          <div className={cn(HOME_INSET, "pt-5 text-center max-sm:pt-0")}>
            <p className="sr-only">{config.hero.summary}</p>
            <p className="mb-6 text-[15px] text-[var(--text-secondary)]">
              Oppulence / {config.module}
            </p>
            <h1
              className="mx-auto max-w-[20ch] text-balance font-normal text-[80px] text-[var(--text-primary)] leading-[1.02] tracking-[-0.035em] max-sm:text-[44px] max-lg:text-[64px]"
              id="product-heading"
            >
              {config.hero.heading}
            </h1>
          </div>
        </div>
      </section>
      {showcase ? (
        <ProductShowcase description={config.hero.description} feature={showcase} />
      ) : null}
      <div className={LANDING_GUTTER}>
        <div
          className={cn(
            HOME_INSET,
            "grid grid-cols-2 border-[var(--border)] border-x max-sm:border-x-0 max-md:grid-cols-1",
          )}
        >
          {features.map((feature) => (
            <ProductFeature feature={feature} key={feature.id} />
          ))}
        </div>
      </div>
    </main>
  );
}
