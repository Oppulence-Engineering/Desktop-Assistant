import Link from "next/link";

import { Chip } from "@sim/emcn";

import { cn } from "@/lib/sim/cn";

import { pricingPlans } from "../../marketing-data";
import { JsonLd } from "../../marketing-primitives";
import { faqJsonLd } from "../../metadata";
import { SimCtaLink } from "../primitives";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { pricingSectionsForColumn } from "./pricing-comparison-data";
import { SimPricingCard } from "./sim-pricing-card";
import { SimSubpageFaqSection } from "./sim-subpage-faq";
import { SIM_SURFACE_CARD } from "./sim-surface-card";

const faqs = [
  {
    question: "What is Watch, exactly?",
    answer:
      "The free plan in the public price list: a 6-month report of what you owe, with source links. It is the first pass, not the live register.",
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
] as const;

const TRUST_CHIPS = ["Flat monthly", "No seat tax", "Cancel any time"] as const;

const UPGRADE_STEPS = [
  {
    title: "Run Watch on recent mail",
    body: "Read the sources before you trust the rows.",
  },
  {
    title: "Move to Chase when the register is weekly work",
    body: "At-risk promises and approved follow-ups, not a one-time report.",
  },
  {
    title: "Add Intelligence for handovers and renewals",
    body: "Change history and export when someone else needs the proof.",
  },
] as const;

const SECTIONS_BY_COLUMN = [
  pricingSectionsForColumn(0),
  pricingSectionsForColumn(1),
  pricingSectionsForColumn(2),
] as const;

/** Sim `/pricing` board — three self-contained spec sheets with Oppulence tiers. */
export function SimPricingPage() {
  return (
    <>
      <JsonLd data={faqJsonLd([...faqs])} />
      <main id="main-content">
        <section
          aria-labelledby="pricing-heading"
          className={cn(
            "flex w-full flex-col gap-7 pb-16 max-sm:pb-12",
            LANDING_CONTENT_WIDTH,
            LANDING_GUTTER,
          )}
          id="pricing"
        >
          <div className="flex flex-col items-center gap-4 pt-2 text-center">
            <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
              [pricing]
            </p>
            <h1
              className="max-w-[24ch] text-balance text-[30px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.02em] max-sm:text-[26px] lg:text-[36px]"
              id="pricing-heading"
            >
              Plans that match how the register enters your week
            </h1>
            <p className="sr-only">
              Oppulence pricing: Watch is free, Chase is ninety-nine dollars per month, Intelligence
              is two hundred forty-nine dollars per month. Flat monthly billing with no seat tax.
            </p>
            <p className="max-w-[52ch] text-pretty text-[var(--text-body)] text-base leading-[1.55]">
              These are the published plans. We are not inventing a fourth tier, a seat tax, or an
              unpublished annual discount to look more like enterprise software.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {TRUST_CHIPS.map((chip) => (
                <Chip key={chip} variant="outline">
                  {chip}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {pricingPlans.map((plan, index) => (
              <SimPricingCard
                badge={plan.recommended ? "Recommended" : undefined}
                cta={{
                  href: plan.ctaHref,
                  label: plan.ctaLabel,
                  variant: plan.recommended ? "primary" : index === 0 ? "border-shadow" : "primary",
                }}
                description={plan.description}
                key={plan.name}
                name={plan.name}
                price={plan.period ? `${plan.price}${plan.period}` : plan.price}
                priceSubtext={plan.period ? "Billed monthly" : "Free forever"}
                sections={SECTIONS_BY_COLUMN[index]}
              />
            ))}
          </div>

          <div className="mt-2 border-[var(--border)] border-t pt-10">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
              <div className="flex flex-col gap-4">
                <h2 className="max-w-[16ch] text-balance text-[28px] text-[var(--text-primary)] leading-[1.08] tracking-[-0.02em] max-sm:text-[24px] lg:text-[32px]">
                  The path is the habit, not the SKU.
                </h2>
                <p className="max-w-[46ch] text-[15px] text-[var(--text-secondary)] leading-[1.55]">
                  Desktop installers and Voice are separate downloads — not separate plans. See{" "}
                  <Link className="underline-offset-4 hover:underline" href="/download">
                    download
                  </Link>{" "}
                  and{" "}
                  <Link className="underline-offset-4 hover:underline" href="/guides/desktop-vs-web">
                    which surface to use
                  </Link>
                  .
                </p>
                <SimCtaLink href="/sign-up" variant="outline" withArrow>
                  Start with Watch
                </SimCtaLink>
              </div>
              <ol className="flex flex-col gap-3">
                {UPGRADE_STEPS.map((step, index) => (
                  <li className={cn(SIM_SURFACE_CARD, "flex gap-4 p-5")} key={step.title}>
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] font-mono text-[13px] text-[var(--text-muted)] tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-[15px] text-[var(--text-primary)] leading-[1.35]">
                        {step.title}
                      </p>
                      <p className="mt-1 text-[14px] text-[var(--text-secondary)] leading-[1.5]">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <SimSubpageFaqSection
            faqs={[...faqs]}
            heading="How the published plans work"
            lede="If a number is not on this page, it is not a public price."
          />
        </section>
      </main>
    </>
  );
}
