import { featurePages } from "../catalog";
import { cn } from "@/lib/sim/cn";

import { FEATURE_RAIL_PREVIEW } from "./features-rail-data";
import { FeaturesRailCard } from "./features-rail-card";
import { SimFeaturesRailLoop } from "./features-rail-loop";
import { HOME_INSET, HOME_TYPE, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";

/** Sim `Features` + infinite `FeaturesRail` with Oppulence feature cards. */
export function SimFeaturesRail() {
  const features = featurePages.slice(0, 4);

  return (
    <section
      aria-labelledby="features-heading"
      className="flex flex-col [container-type:inline-size]"
      id="features"
    >
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div className={HOME_INSET}>
          <h2
            className={cn(
              "mb-16 max-w-[20ch] text-balance text-[var(--text-primary)] max-sm:mb-3 max-lg:mb-12",
              HOME_TYPE.h2,
            )}
            id="features-heading"
          >
            What you actually get on the ledger.
          </h2>
          <p className="mb-8 hidden text-[13px] text-[var(--text-secondary)] max-sm:block">
            Swipe to explore
          </p>

          <SimFeaturesRailLoop label="Core Oppulence features">
            {features.map((feature) => (
              <FeaturesRailCard
                description={feature.description}
                eyebrow={feature.eyebrow}
                href={feature.path}
                key={feature.slug}
                preview={FEATURE_RAIL_PREVIEW[feature.slug] ?? "register"}
              />
            ))}
          </SimFeaturesRailLoop>
        </div>
      </div>
    </section>
  );
}
