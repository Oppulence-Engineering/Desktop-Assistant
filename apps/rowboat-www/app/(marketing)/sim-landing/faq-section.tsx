import { cn } from "@/lib/sim/cn";

import { homepageFaqs } from "../catalog";
import { HOME_INSET, HOME_TYPE, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "./tokens";
import { SimLandingFaq } from "./landing-faq";

/** Sim-style FAQ section with Oppulence copy (homepage-only; sim.ai has no homepage FAQ). */
export function SimFaqSection() {
  return (
    <section
      aria-labelledby="homepage-faq-heading"
      className={cn(
        "flex w-full flex-col border-t border-[var(--border)]",
        LANDING_CONTENT_WIDTH,
        LANDING_GUTTER,
      )}
      id="faq"
    >
      <div className={cn("py-16 max-sm:py-10", HOME_INSET)}>
        <h2
          className={cn("max-w-[28ch] text-balance text-[var(--text-primary)]", HOME_TYPE.h2)}
          id="homepage-faq-heading"
        >
          The things people ask before they start.
        </h2>
        <p className={cn("mt-4 max-w-[42ch] text-pretty text-[var(--text-body)]", HOME_TYPE.lead)}>
          These are the questions that stop a careful team. The answers are the product constraints,
          not slogans.
        </p>
        <div className="mt-10 border-t border-[var(--border)]">
          <SimLandingFaq faqs={homepageFaqs} />
        </div>
      </div>
    </section>
  );
}
