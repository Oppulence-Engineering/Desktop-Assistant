import { cn } from "@/lib/sim/cn";

import { FOOTER_ARTWORK_SIZES } from "./footer-artwork";
import { FooterArtworkPlate } from "./footer-artwork-plate";
import { SimHeroCta } from "./primitives";
import { HOME_TYPE, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";

/** One shared closing statement, with a deliberate line break between sentences. */
const CTA_HEADLINE = ["Read one closed customer.", "Confirm the rows."] as const;

/**
 * Painted pre-footer CTA for the Oppulence homepage, mounted once by {@link SimLandingShell}.
 * Theme classes select the matching painting without client state; the sky mask keeps copy clear.
 */
export function SimClosingCta() {
  return (
    <section
      aria-labelledby="cta-heading"
      className="relative isolate flex w-full flex-col"
      id="cta"
    >
      <div
        className={cn(
          "relative z-10 flex flex-col items-center gap-8 pt-10 text-center max-sm:gap-7 max-sm:pt-6 max-lg:pt-8",
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER,
        )}
      >
        <h2
          className={cn("text-balance text-[var(--text-primary)]", HOME_TYPE.h2Display)}
          id="cta-heading"
        >
          {CTA_HEADLINE.map((line) => (
            <span className="block" key={line}>
              {line}{" "}
            </span>
          ))}
        </h2>
        <div className="max-sm:w-full">
          <SimHeroCta size="display" />
        </div>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none relative -mt-[clamp(96px,12.5vw,240px)] aspect-video w-full max-sm:-mt-6 max-sm:aspect-[16/10]"
      >
        <FooterArtworkPlate
          className="sim-closing-artwork__plate object-cover object-center"
          preload
          sizes={FOOTER_ARTWORK_SIZES}
        />
      </div>
    </section>
  );
}
