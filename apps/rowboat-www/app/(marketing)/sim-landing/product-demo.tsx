"use client";

import { cn } from "@/lib/sim/cn";

import { HOME_INSET, LANDING_CONTENT_WIDTH, LANDING_GUTTER, LANDING_STAGE_RADIUS } from "./tokens";
import { SimCtaLink } from "./primitives";
import { ProductDemoCaption } from "./product-demo-caption";
import { ProductDemoBeatProvider } from "./product-demo-context";
import { ProductDemoScene } from "./product-demo-visual";

const PAPER = "bg-[#F8F8F8] dark:bg-[var(--surface-2)]";
const FRAME_PLAYER = "lg:aspect-[2/1] lg:max-w-[calc((100svh-168px)*2)]";
const TITLE_INSET = "lg:top-[13%]";
const LINK_INSET = "lg:bottom-[13%]";

/** Sim `ProductDemo` player with beat-synced captions and lazy screenshot loop. */
export function SimProductDemo() {
  return (
    <section aria-labelledby="product-demo-heading" className="w-full" id="product-demo">
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div className={HOME_INSET}>
          <ProductDemoBeatProvider>
            <div
              className={cn(
                "relative mx-auto flex w-full flex-col overflow-hidden border border-[var(--border)]",
                PAPER,
                LANDING_STAGE_RADIUS,
                FRAME_PLAYER,
              )}
            >
              <ProductDemoCaption
                className={cn("px-6 pt-10 pb-6 lg:absolute lg:inset-x-0 lg:p-0", TITLE_INSET)}
              />

              <ProductDemoScene />

              <div
                className={cn(
                  "relative z-10 mx-auto w-fit pt-4 pb-10 lg:absolute lg:inset-x-0 lg:p-0",
                  LINK_INSET,
                )}
              >
                <SimCtaLink href="/sign-up" variant="outline" withArrow>
                  Start for free
                </SimCtaLink>
              </div>
            </div>
          </ProductDemoBeatProvider>
        </div>
      </div>
    </section>
  );
}
