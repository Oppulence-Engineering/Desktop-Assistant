import Image from "next/image";

import { cn } from "@/lib/sim/cn";

import type { FeatureDetail, MarketingPage } from "../../marketing-data";
import { featureLinks } from "../../marketing-data";
import { JsonLd, RelatedPages } from "../../marketing-primitives";
import { breadcrumbJsonLd } from "../../metadata";
import { SimCtaLink } from "../primitives";
import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SIM_SURFACE_CARD } from "./sim-surface-card";

function screenshotForPage(page: MarketingPage) {
  if (page.path.includes("desktop")) return "/marketing/relationship-desktop.png";
  if (page.path.includes("widget")) return "/marketing/relationship-web-detail.png";
  return "/marketing/relationship-web-list.png";
}

/** Sim feature mirror pages — legacy FeatureMirror URLs without SEO lander override. */
export function SimFeatureMirrorPage({
  page,
  details,
}: {
  page: MarketingPage;
  details: FeatureDetail;
}) {
  const capabilitySections = details.capabilities ?? details.sections;
  const relatedPages =
    details.relatedPages ?? featureLinks.filter((item) => item.href !== `/${page.path}`).slice(0, 3);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: page.eyebrow, path: `/${page.path}` },
        ])}
      />
      <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <SimSubpageHero
            description={page.description}
            eyebrow={`[${page.eyebrow.toLowerCase()}]`}
            title={page.title}
            titleId="feature-mirror-heading"
          >
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
            <div className={cn(SIM_SURFACE_CARD, "overflow-hidden")}>
              <Image
                alt={`Oppulence desktop for ${page.eyebrow}`}
                className="h-auto w-full"
                height={900}
                priority
                src={screenshotForPage(page)}
                width={1400}
              />
            </div>
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <section className="grid gap-0 lg:grid-cols-2">
            <article className="border-[var(--border)] border-b px-6 py-10 lg:border-r lg:border-b-0">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [why]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                Why it matters
              </h2>
              <p className="max-w-[52ch] text-[15px] text-[var(--text-body)] leading-[1.55]">
                {details.summary}
              </p>
            </article>
            <article className="px-6 py-10">
              <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                [how it works]
              </p>
              <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em]">
                The sequence.
              </h2>
              <ol className="flex max-w-[52ch] list-decimal flex-col gap-2 pl-5 text-[15px] text-[var(--text-body)] leading-[1.55]">
                {details.workflow.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          </section>

          {page.bullets.length > 0 ? (
            <>
              <div className="h-px w-full bg-[var(--border)]" />
              <section className="px-6 py-10">
                <h2 className="mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
                  What this page is about.
                </h2>
                <div className="grid gap-4 md:grid-cols-3">
                  {page.bullets.slice(0, 3).map((bullet, index) => (
                    <article className={cn(SIM_SURFACE_CARD, "flex flex-col gap-2 p-5")} key={bullet}>
                      <p className="text-[12px] text-[var(--text-muted)] tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </p>
                      <p className="text-[15px] text-[var(--text-body)] leading-[1.55]">{bullet}</p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {capabilitySections.length > 0 ? (
            <>
              <div className="h-px w-full bg-[var(--border)]" />
              <section className="px-6 py-10">
                <h2 className="mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
                  What it actually does.
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {capabilitySections.map((section) => (
                    <article className={cn(SIM_SURFACE_CARD, "flex flex-col gap-2 p-5")} key={section.title}>
                      <h3 className="text-[16px] text-[var(--text-primary)]">{section.title}</h3>
                      <p className="text-[14px] text-[var(--text-secondary)] leading-[1.5]">
                        {section.body}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {details.useCases && details.useCases.length > 0 ? (
            <>
              <div className="h-px w-full bg-[var(--border)]" />
              <section className="px-6 py-10">
                <h2 className="mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
                  Where it shows up.
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {details.useCases.map((useCase) => (
                    <article className={cn(SIM_SURFACE_CARD, "flex flex-col gap-2 p-5")} key={useCase.title}>
                      <h3 className="text-[16px] text-[var(--text-primary)]">{useCase.title}</h3>
                      <p className="text-[14px] text-[var(--text-secondary)] leading-[1.5]">
                        {useCase.body}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {details.outcomes.length > 0 ? (
            <>
              <div className="h-px w-full bg-[var(--border)]" />
              <section className="px-6 py-10">
                <h2 className="mb-3 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]">
                  What you keep
                </h2>
                <div className="flex max-w-[60ch] flex-col gap-2 text-[15px] text-[var(--text-body)] leading-[1.55]">
                  {details.outcomes.map((outcome) => (
                    <p key={outcome}>{outcome}</p>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          <div className="h-px w-full bg-[var(--border)]" />

          <div className="px-6 py-10">
            <RelatedPages
              items={relatedPages.map((item) => ({
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
