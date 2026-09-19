import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import type { MarketingPage } from "../../marketing-data";
import { JsonLd, RelatedPages } from "../../marketing-primitives";
import { breadcrumbJsonLd, definedTermJsonLd, faqJsonLd } from "../../metadata";
import type { SeoLander } from "../../seo-theme";
import { SimLandingFaq } from "../landing-faq";
import { SimCtaLink } from "../primitives";
import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SIM_SURFACE_CARD } from "./sim-surface-card";

/** Sim SEO definition lander — Ferndesk shape with Oppulence copy. */
export function SimSeoLanderPage({ page, lander }: { page: MarketingPage; lander: SeoLander }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Answers", path: "/answers" },
          { name: lander.query, path: `/${lander.path}` },
        ])}
      />
      <JsonLd data={definedTermJsonLd(lander.query, lander.definition)} />
      <JsonLd data={faqJsonLd(lander.faqs)} />

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
              <li className="text-[var(--text-primary)]">{lander.query}</li>
            </ol>
          </nav>

          <SimSubpageHero
            description={page.description}
            eyebrow={`[${lander.query.toLowerCase()}]`}
            title={page.title}
            titleId="seo-lander-heading"
          >
            <div className="flex flex-wrap gap-2 pt-2">
              {lander.chips.map((chip) => (
                <span
                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                  key={chip}
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-4">
              <SimCtaLink href={page.ctaHref ?? "/sign-up"}>
                {page.ctaLabel ?? "Start for free"}
              </SimCtaLink>
              <SimCtaLink href="/product" variant="outline">
                See the loop
              </SimCtaLink>
            </div>
          </SimSubpageHero>
        </div>

        <SimPageDivider />

        <SimBorderedColumn>
          <section className="px-6 py-10">
            <p className="mb-2 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
              [definition]
            </p>
            <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
              {lander.definitionTitle}
            </h2>
            <p className="max-w-[60ch] text-[15px] text-[var(--text-body)] leading-[1.55]">
              {lander.definition}
            </p>
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <section className="px-6 py-10">
            <h2 className="mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
              Three jobs that are not the same.
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {lander.distinctions.map((item) => (
                <article
                  className={cn(SIM_SURFACE_CARD, "flex flex-col gap-2 p-5")}
                  key={item.title}
                >
                  <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                    {item.chip}
                  </p>
                  <h3 className="text-[16px] text-[var(--text-primary)]">{item.title}</h3>
                  <p className="text-[14px] text-[var(--text-secondary)] leading-[1.5]">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <section className="grid gap-0 lg:grid-cols-2">
            <article className="border-[var(--border)] border-b px-6 py-10 lg:border-r lg:border-b-0">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [for]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                This page is for you if
              </h2>
              <ul className="flex max-w-[52ch] list-disc flex-col gap-2 pl-5 text-[15px] text-[var(--text-body)] leading-[1.55]">
                {lander.for.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
            <article className="px-6 py-10">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [not for]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                This is the wrong page if
              </h2>
              <ul className="flex max-w-[52ch] list-disc flex-col gap-2 pl-5 text-[15px] text-[var(--text-body)] leading-[1.55]">
                {lander.notFor.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <section className="px-6 py-10">
            <h2 className="mb-2 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
              Questions this URL actually answers
            </h2>
            <p className="mb-4 max-w-[720px] text-[14px] text-[var(--text-muted)] leading-[150%]">
              The leftover slug is a search path. The answers stay honest about the product.
            </p>
            <SimLandingFaq faqs={lander.faqs} />
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <div className="px-6 py-10">
            <RelatedPages
              items={lander.cluster.map((item) => ({
                label: item.label,
                href: item.href,
                description: item.description,
              }))}
            />
          </div>
        </SimBorderedColumn>

        <SimPageFooterRule />
      </div>
    </>
  );
}
