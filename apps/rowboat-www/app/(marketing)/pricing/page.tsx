import Link from "next/link";

import { Badge } from "@oppulence/ui/components/badge";
import { MarketingSpan } from "../marketing-primitives";

import { pricingPlans } from "../marketing-data";
import { MarketingFaq } from "../marketing-faq";
import {
  JsonLd,
  MarketingBreadcrumbs,
  MarketingCta,
  SectionHeading,
} from "../marketing-primitives";
import { faqJsonLd, marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Pricing",
  description:
    "Watch is a free 90-day report. Chase is the live register. Intelligence adds change history and export. Flat monthly. No seat tax.",
  path: "/pricing",
});

const faqs = [
  {
    question: "What is Watch, exactly?",
    answer:
      "The free plan in the public price list: a 90-day report of what you owe, with source links. It is the first pass, not the live register.",
  },
  {
    question: "When do I need Chase?",
    answer:
      "When the register is part of the week: at-risk promises and approved follow-ups, not just a one-time report.",
  },
  {
    question: "What does Intelligence add?",
    answer:
      "Change summaries and exportable records on top of Chase. Useful for renewals, escalations, and handovers.",
  },
  {
    question: "Is there a seat tax?",
    answer:
      "The published plans are flat monthly. We are not adding a per-seat line to look more like enterprise software.",
  },
  {
    question: "Is there an annual price?",
    answer:
      "Not on the public list. If that is published later, it will be on this page, not in a footnote.",
  },
  {
    question: "What happens if I cancel?",
    answer:
      "You can cancel any time. Local vault files stay on disk. Cloud relationship state follows the account deletion path in the product.",
  },
];

const matrix = [
  { label: "90-day report with source links", watch: true, chase: true, intelligence: true },
  { label: "What you owe", watch: true, chase: true, intelligence: true },
  { label: "Live register", watch: false, chase: true, intelligence: true },
  { label: "At-risk promises", watch: false, chase: true, intelligence: true },
  { label: "Approved follow-ups", watch: false, chase: true, intelligence: true },
  { label: "Change summaries", watch: false, chase: false, intelligence: true },
  { label: "Exportable records", watch: false, chase: false, intelligence: true },
  { label: "Flat monthly billing", watch: true, chase: true, intelligence: true },
] as const;

const who = [
  {
    name: "Watch",
    body: "You want a first pass over recent mail before you decide the register is a habit.",
  },
  {
    name: "Chase",
    body: "The queue is part of Monday. Drafts need to wait. The report is no longer enough.",
  },
  {
    name: "Intelligence",
    body: "Renewals, escalations, and handovers need the change history, not just the open rows.",
  },
] as const;

function Mark({ on }: { on: boolean }) {
  return on ? (
    <Badge className="mk-pricing-yes rounded-none" variant="outline">
      Yes
    </Badge>
  ) : (
    <Badge className="mk-pricing-no rounded-none" variant="ghost">
      —
    </Badge>
  );
}

export default function PricingRoutePage() {
  return (
    <article className="mk-capability linear-subpage sm-pricing">
      <JsonLd data={faqJsonLd(faqs)} />
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Pricing" }]} />

        <header className="sm-pricing-hero">
          <p className="linear-eyebrow">[pricing]</p>
          <h1>Start with the free report. Upgrade when the register is part of the week.</h1>
          <p>
            These are the published plans. We are not inventing a fourth tier, a seat tax, or an
            unpublished annual discount to look more like enterprise software.
          </p>
          <div aria-label="Pricing principles">
            <Badge className="rounded-none" variant="outline">
              Flat monthly
            </Badge>
            <Badge className="rounded-none" variant="outline">
              No seat tax
            </Badge>
            <Badge className="rounded-none" variant="outline">
              Cancel any time
            </Badge>
          </div>
        </header>

        <section aria-label="Oppulence pricing plans" className="sm-pricing-board">
          {pricingPlans.map((plan) => (
            <article
              className={
                plan.recommended ? "sm-pricing-plan sm-pricing-plan-featured" : "sm-pricing-plan"
              }
              key={plan.name}
            >
              <div>
                <p>{plan.name}</p>
                {plan.recommended ? (
                  <Badge className="rounded-none" variant="secondary">
                    Recommended
                  </Badge>
                ) : null}
              </div>
              <strong>
                {plan.price}
                {plan.period ? <small>{plan.period}</small> : null}
              </strong>
              <p>{plan.description}</p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link
                className="sm-memory-button sm-memory-button-primary w-full"
                href={plan.ctaHref}
              >
                {plan.ctaLabel}
              </Link>
            </article>
          ))}
        </section>

        <section className="mk-pricing-matrix-wrap">
          <SectionHeading
            eyebrow="[compare tiers]"
            title="What actually changes when you upgrade."
          />
          <div className="mk-compare-table" role="table" aria-label="Plan comparison">
            <div className="mk-compare-row mk-compare-row-head" role="row">
              <MarketingSpan className="font-normal" role="columnheader">
                Included
              </MarketingSpan>
              <MarketingSpan className="font-normal" role="columnheader">
                Watch
              </MarketingSpan>
              <MarketingSpan className="font-normal" role="columnheader">
                Chase
              </MarketingSpan>
              <MarketingSpan className="font-normal" role="columnheader">
                Intelligence
              </MarketingSpan>
            </div>
            {matrix.map((row) => (
              <div className="mk-compare-row" key={row.label} role="row">
                <MarketingSpan className="font-normal" role="cell">
                  {row.label}
                </MarketingSpan>
                <MarketingSpan className="font-normal" role="cell">
                  <Mark on={row.watch} />
                </MarketingSpan>
                <MarketingSpan className="font-normal" role="cell">
                  <Mark on={row.chase} />
                </MarketingSpan>
                <MarketingSpan className="font-normal" role="cell">
                  <Mark on={row.intelligence} />
                </MarketingSpan>
              </div>
            ))}
          </div>
        </section>

        <section className="mk-capability-grid">
          {who.map((item) => (
            <article key={item.name}>
              <h2>{item.name}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </section>

        <section className="mk-pricing-path">
          <SectionHeading eyebrow="[upgrade]" title="The path is the habit, not the SKU." />
          <ol>
            <li>Run Watch on recent mail. Read the sources.</li>
            <li>Move to Chase when you are working the live register every week.</li>
            <li>Add Intelligence when handovers and renewals need the change history exported.</li>
          </ol>
          <p>
            Desktop installers are a separate download, not a separate plan. Voice is a separate
            app. See <Link href="/download">download</Link> and{" "}
            <Link href="/guides/desktop-vs-web">which surface to use</Link>.
          </p>
        </section>

        <MarketingFaq
          heading="How the published plans work"
          items={faqs}
          lede="If a number is not on this page, it is not a public price."
        />
        <MarketingCta
          title="Start with Watch."
          body="The free report is the evaluation. Chase is the weekly habit."
        />
      </div>
    </article>
  );
}
