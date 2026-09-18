import Image from "next/image";

import { cn } from "@/lib/sim/cn";

import { HeroPlatformLoopMount } from "./hero-platform-loop-mount";
import { SimMobileHeroPreview } from "./mobile-hero-preview";
import { LANDING_STAGE_RADIUS } from "./tokens";

const ARTWORK_SIZES =
  "(min-width: 1728px) 1648px, (min-width: 1280px) calc(100vw - 80px), calc(100vw - 72px)";

/**
 * Sim `HeroPlatformStage` — mobile workflow below `lg`, painted interactive loop at desktop.
 */
export function SimHeroPlatformStage() {
  return (
    <>
      <SimMobileHeroPreview />
      <div
        className={cn(
          "relative isolate mt-20 w-full overflow-hidden bg-[var(--surface-3)] py-20",
          "max-lg:mt-16 max-lg:hidden max-xl:p-6",
          LANDING_STAGE_RADIUS,
        )}
        data-preview-stage=""
      >
        <picture className="pointer-events-none absolute inset-0">
          <Image
            alt=""
            aria-hidden="true"
            className="object-cover dark:brightness-[0.28]"
            data-preview-background=""
            fill
            priority
            sizes={ARTWORK_SIZES}
            src="/marketing/relationship-system/observe.webp"
          />
        </picture>

        <div
          aria-label="Interactive Oppulence product preview"
          className={cn(
            "sim-product-preview relative aspect-[1280/735] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-xs max-xl:min-h-[480px]",
            "w-full xl:mx-auto xl:w-[83.333%]",
          )}
          data-product-preview=""
          role="region"
        >
          <HeroPlatformLoopMount />
        </div>
      </div>
    </>
  );
}
