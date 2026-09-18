import { SimCtaLink } from "../../primitives";
import { EdgeFade } from "../../edge-fade";
import type { SolutionsProductFeatureConfig } from "./types";

interface ProductFeatureProps {
  feature: SolutionsProductFeatureConfig;
}

/** Floating product detail and caption — ported from sim.ai `ProductFeature`. */
export function ProductFeature({ feature }: ProductFeatureProps) {
  return (
    <section
      aria-labelledby={`${feature.id}-heading`}
      className="min-w-0 scroll-mt-32 border-[var(--border)] border-t border-b even:border-l max-md:even:border-l-0"
      id={feature.id}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none relative isolate h-[460px] select-none overflow-hidden [container-type:inline-size] max-sm:h-[380px] max-xl:h-[420px]"
        data-product-feature-visual={feature.id}
        inert
      >
        <div className="relative z-0 size-full">{feature.visual}</div>
        <EdgeFade depth="preview" edges={["right"]} ground="canvas" />
        <EdgeFade depth="stage" edges={["bottom"]} ground="canvas" />
      </div>
      <div className="px-8 pt-5 pb-9 max-sm:px-0 max-sm:pt-2 max-sm:pb-7">
        <h2
          className="text-balance font-normal text-[15px] text-[var(--text-primary)] leading-6"
          id={`${feature.id}-heading`}
        >
          {feature.title}
        </h2>
        <p className="mt-1 max-w-[44ch] text-balance text-[15px] text-[var(--text-secondary)] leading-6">
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
    </section>
  );
}
