import { cn } from "@/lib/sim/cn";

import type { CapabilityPage } from "../../catalog";
import { JsonLd, RelatedPages } from "../../marketing-primitives";
import { breadcrumbJsonLd, faqJsonLd } from "../../metadata";
import { SimLandingFaq } from "../landing-faq";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER, HOME_INSET } from "../tokens";
import { SimSolutionsProductPage, capabilityToSolutionsConfig } from "./solutions-product";
import { SimPageFooterRule } from "./sim-subpage-hero";

const kindCrumb: Record<CapabilityPage["kind"], { label: string; href: string }> = {
  feature: { label: "Features", href: "/features" },
  "use-case": { label: "Use cases", href: "/use-cases" },
  integration: { label: "Integrations", href: "/integrations" },
  guide: { label: "Guides", href: "/guides" },
};

/** Sim solutions-style detail page — body matches sim.ai `/knowledge` and `/tables`. */
export function SimCapabilityPage({ page }: { page: CapabilityPage }) {
  const parent = kindCrumb[page.kind];
  const config = capabilityToSolutionsConfig(page);
  const hasSupplement = page.faqs.length > 0 || page.related.length > 0;

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: parent.label, path: parent.href },
          { name: page.eyebrow, path: page.path },
        ])}
      />
      {page.faqs.length > 0 ? <JsonLd data={faqJsonLd(page.faqs)} /> : null}

      <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
        <SimSolutionsProductPage config={config} />

        {hasSupplement ? (
          <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, "mt-24 max-sm:mt-16")}>
            <div className={cn(HOME_INSET, "border-[var(--border)] border-t pt-16 max-sm:pt-10")}>
              {page.faqs.length > 0 ? (
                <section className="pb-12 max-sm:pb-8">
                  <h2 className="mb-5 font-normal text-[15px] text-[var(--text-secondary)] uppercase tracking-[0.06em]">
                    Questions
                  </h2>
                  <SimLandingFaq faqs={page.faqs} />
                </section>
              ) : null}
              {page.related.length > 0 ? (
                <section
                  className={
                    page.faqs.length > 0 ? "border-[var(--border)] border-t pt-12 max-sm:pt-8" : ""
                  }
                >
                  <RelatedPages items={page.related} />
                </section>
              ) : null}
            </div>
          </div>
        ) : null}

        <SimPageFooterRule />
      </div>
    </>
  );
}
