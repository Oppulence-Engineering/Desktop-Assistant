import { cn } from "@/lib/sim/cn";

import type { MarketingFaqItem } from "../../marketing-faq";
import { SimLandingFaq } from "../landing-faq";

/** Sim comparisons FAQ block — bordered column, `LandingFAQ` accordion. */
export function SimSubpageFaqSection({
  faqs,
  heading,
  lede,
  className,
}: {
  faqs: MarketingFaqItem[];
  heading: string;
  lede?: string;
  className?: string;
}) {
  if (faqs.length === 0) return null;

  return (
    <section
      aria-labelledby="subpage-faq-heading"
      className={cn("border-t border-[var(--border)] pt-10", className)}
    >
      <h2
        className="mb-2 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
        id="subpage-faq-heading"
      >
        {heading}
      </h2>
      {lede ? (
        <p className="mb-4 max-w-[720px] text-[var(--text-muted)] text-sm leading-[150%] lg:text-base">
          {lede}
        </p>
      ) : null}
      <SimLandingFaq faqs={faqs} />
    </section>
  );
}
