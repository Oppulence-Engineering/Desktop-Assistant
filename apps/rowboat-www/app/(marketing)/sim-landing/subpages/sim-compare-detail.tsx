import Link from "next/link";

import { ChipLink } from "@sim/emcn";

import { cn } from "@/lib/sim/cn";

import { comparePages, type ComparePage } from "../../compare-catalog";
import { JsonLd, RelatedPages } from "../../marketing-primitives";
import { breadcrumbJsonLd, faqJsonLd } from "../../metadata";
import { SimChevronArrow } from "../chevron-arrow";
import { HOME_INSET, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SimLandingFaq } from "../landing-faq";
import { SIM_SURFACE_CARD } from "./sim-surface-card";

function CompareCategoryTabs({ page }: { page: ComparePage }) {
  return (
    <nav
      aria-label="Compare categories"
      className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {comparePages.map((item) => (
        <ChipLink
          active={item.slug === page.slug}
          href={item.path}
          key={item.slug}
          variant="outline"
        >
          {item.eyebrow}
        </ChipLink>
      ))}
    </nav>
  );
}

/** Vertical seam story — them and us as sequential beats, not side-by-side competitor cards. */
function CompareSeamStory({ page }: { page: ComparePage }) {
  return (
    <div className="relative border-[var(--border)] border-l pl-6 sm:pl-8">
      <section className="pb-10">
        <p className="mb-2 font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
          01 · the usual category
        </p>
        <h2 className="text-[22px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em]">
          {page.them.title}
        </h2>
        <p className="mt-3 max-w-[56ch] text-[15px] text-[var(--text-body)] leading-[1.65]">
          {page.them.body}
        </p>
      </section>
      <section>
        <p className="mb-2 font-mono text-[11px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
          02 · where oppulence sits
        </p>
        <h2 className="text-[22px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em]">
          {page.us.title}
        </h2>
        <p className="mt-3 max-w-[56ch] text-[15px] text-[var(--text-body)] leading-[1.65]">
          {page.us.body}
        </p>
      </section>
    </div>
  );
}

/** Job splits as stacked cards — not Sim's wide feature matrix table. */
function CompareJobStack({ page }: { page: ComparePage }) {
  return (
    <div className="flex flex-col gap-3">
      {page.rows.map((row, index) => (
        <article className={cn(SIM_SURFACE_CARD, "p-5 sm:p-6")} key={row.label}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[16px] text-[var(--text-primary)] leading-[1.3]">{row.label}</h3>
            <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 sm:gap-6">
            <div>
              <dt className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.06em]">
                The usual tool
              </dt>
              <dd className="mt-1.5 text-[14px] text-[var(--text-body)] leading-[1.55]">
                {row.them}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.06em]">
                Oppulence
              </dt>
              <dd className="mt-1.5 text-[14px] text-[var(--text-body)] leading-[1.55]">
                {row.us}
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

/**
 * Compare detail — editorial seam page with category tabs and vertical story.
 * Structurally unlike Sim competitor matrices or legal sticky TOCs.
 */
export function SimCompareDetailPage({ page }: { page: ComparePage }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: page.eyebrow, path: page.path },
        ])}
      />
      {page.faqs.length > 0 ? <JsonLd data={faqJsonLd(page.faqs)} /> : null}

      <article className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, "pb-16 max-sm:pb-12")}>
        <div className={cn(HOME_INSET, "pt-2")}>
          <Link
            className="group/link mb-6 inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            href="/compare"
          >
            <SimChevronArrow active className="rotate-180" />
            All category seams
          </Link>

          <CompareCategoryTabs page={page} />

          <header className="mt-8 max-w-[760px]">
            <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
              [compare · {page.eyebrow.toLowerCase()}]
            </p>
            <h1
              className="mt-3 text-balance text-[32px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.025em] max-sm:text-[28px] lg:text-[44px]"
              id="compare-detail-heading"
            >
              {page.title}
            </h1>
          </header>

          <div
            className={cn(
              SIM_SURFACE_CARD,
              "mt-8 border-[var(--text-primary)]/10 bg-[var(--surface-2)] p-6 sm:p-7",
            )}
          >
            <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
              [the seam in one line]
            </p>
            <p className="mt-2 max-w-[62ch] text-[17px] text-[var(--text-primary)] leading-[1.55]">
              {page.description}
            </p>
            <p className="mt-3 max-w-[62ch] text-[15px] text-[var(--text-secondary)] leading-[1.6]">
              {page.lede}
            </p>
          </div>
        </div>

        <div className={cn(HOME_INSET, "mt-14 flex flex-col gap-14")}>
          <section aria-labelledby="seam-story-heading">
            <h2
              className="mb-6 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]"
              id="seam-story-heading"
            >
              The seam
            </h2>
            <CompareSeamStory page={page} />
          </section>

          <section aria-labelledby="job-splits-heading">
            <h2
              className="mb-6 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]"
              id="job-splits-heading"
            >
              Where the jobs split
            </h2>
            <CompareJobStack page={page} />
          </section>

          {page.notes.length > 0 ? (
            <section aria-labelledby="notes-heading">
              <h2
                className="mb-4 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]"
                id="notes-heading"
              >
                Honest limits
              </h2>
              <ul className="flex max-w-[62ch] flex-col gap-3 border-[var(--border)] border-l pl-5">
                {page.notes.map((note) => (
                  <li
                    className="text-[15px] text-[var(--text-body)] leading-[1.6] marker:text-[var(--text-muted)] [list-style:square]"
                    key={note}
                  >
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {page.faqs.length > 0 ? (
            <section aria-labelledby="faq-heading">
              <h2
                className="mb-4 text-[22px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em]"
                id="faq-heading"
              >
                Questions people actually ask
              </h2>
              <SimLandingFaq faqs={page.faqs} />
            </section>
          ) : null}

          {page.related.length > 0 ? (
            <section aria-labelledby="related-heading">
              <h2
                className="mb-4 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]"
                id="related-heading"
              >
                Keep going
              </h2>
              <RelatedPages items={page.related} />
            </section>
          ) : null}
        </div>
      </article>
    </>
  );
}
