import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import type { MarketingPage } from "../../marketing-data";
import { JsonLd } from "../../marketing-primitives";
import { breadcrumbJsonLd, faqJsonLd } from "../../metadata";
import type { SeoAlternative } from "../../seo-theme";
import { SimLandingFaq } from "../landing-faq";
import { SimCtaLink } from "../primitives";
import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";

const archiveChips = ["No invented vendor ranking", "Keep the search URL", "Honest seam"] as const;

/** Sim SEO alternative article — blog archive comparison pages. */
export function SimSeoAlternativePage({
  page,
  alternative,
}: {
  page: MarketingPage;
  alternative: SeoAlternative;
}) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Answers", path: "/answers" },
          { name: alternative.competitor, path: `/blog/${alternative.slug}` },
        ])}
      />
      <JsonLd data={faqJsonLd(alternative.faqs)} />

      <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <nav aria-label="Breadcrumb" className="mb-6 text-[12px] text-[var(--text-secondary)]">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link className="hover:text-[var(--text-primary)]" href="/">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link className="hover:text-[var(--text-primary)]" href="/answers">
                  Answers
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-[var(--text-primary)]">{alternative.competitor}</li>
            </ol>
          </nav>

          <SimSubpageHero
            description={page.description}
            eyebrow="[alternatives]"
            title={page.title}
            titleId="seo-alternative-heading"
          >
            <div className="flex flex-wrap gap-2 pt-2">
              {archiveChips.map((chip) => (
                <span
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                  key={chip}
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="pt-4">
              <SimCtaLink href="/sign-up">Start for free</SimCtaLink>
            </div>
          </SimSubpageHero>
        </div>

        <SimPageDivider />

        <SimBorderedColumn>
          <section className="grid gap-0 lg:grid-cols-2">
            <article className="border-[var(--border)] border-b px-6 py-10 lg:border-r lg:border-b-0">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [what they are]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                {alternative.competitor} is {alternative.category} software.
              </h2>
              <p className="max-w-[52ch] text-[15px] text-[var(--text-body)] leading-[1.55]">
                {alternative.whatTheyAre}
              </p>
            </article>
            <article className="px-6 py-10">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [what we are]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                Oppulence is a commitment ledger.
              </h2>
              <p className="max-w-[52ch] text-[15px] text-[var(--text-body)] leading-[1.55]">
                {alternative.whatWeAre}
              </p>
            </article>
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <section className="grid gap-0 lg:grid-cols-2">
            <article className="border-[var(--border)] border-b px-6 py-10 lg:border-r lg:border-b-0">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [keep them]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                Stay in that category when
              </h2>
              <ul className="flex max-w-[52ch] list-disc flex-col gap-2 pl-5 text-[15px] text-[var(--text-body)] leading-[1.55]">
                {alternative.keepThemWhen.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="px-6 py-10">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [choose us]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                Sit the register next to them when
              </h2>
              <ul className="flex max-w-[52ch] list-disc flex-col gap-2 pl-5 text-[15px] text-[var(--text-body)] leading-[1.55]">
                {alternative.chooseUsWhen.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <section className="px-6 py-10">
            <h2 className="mb-2 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
              The honest comparison
            </h2>
            <p className="mb-4 max-w-[720px] text-[14px] text-[var(--text-muted)] leading-[150%]">
              We will not publish a fake ranked list of help-center vendors.
            </p>
            <SimLandingFaq faqs={alternative.faqs} />
          </section>
        </SimBorderedColumn>

        <SimPageFooterRule />
      </div>
    </>
  );
}
