import Link from "next/link";

import { ChipLink } from "@sim/emcn";

import { cn } from "@/lib/sim/cn";

import type { ComparePage } from "../../compare-catalog";
import { SimChevronArrow } from "../chevron-arrow";
import { SimCtaLink } from "../primitives";
import { HOME_INSET, LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";

const PRINCIPLES = [
  "Category seams, not logo grids",
  "Named tools where we connect",
  "No invented scorecards",
] as const;

/**
 * Compare index — ruled seam stack, not Sim's competitor card grid or matrix index.
 * Each row is one category boundary (CRM, inbox, …) read top-to-bottom.
 */
export function SimCompareHub({
  heading,
  description,
  pages,
}: {
  heading: string;
  description: string;
  pages: ComparePage[];
}) {
  return (
    <main
      className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, "pb-16 max-sm:pb-12")}
      id="main-content"
    >
      <div
        className={cn(
          HOME_INSET,
          "grid gap-10 pt-2 pb-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-end",
        )}
      >
        <header>
          <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
            [compare]
          </p>
          <h1
            className="mt-3 max-w-[16ch] text-balance text-[40px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.025em] max-sm:text-[32px] lg:text-[48px]"
            id="compare-heading"
          >
            {heading}
          </h1>
          <p className="mt-5 max-w-[52ch] text-[17px] text-[var(--text-body)] leading-[1.6] max-sm:text-base">
            {description}
          </p>
        </header>
        <aside className="border-[var(--border)] border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
            [how to read these]
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {PRINCIPLES.map((item) => (
              <li className="text-[14px] text-[var(--text-secondary)] leading-[1.5]" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section aria-labelledby="compare-seams-heading" className={HOME_INSET}>
        <h2
          className="mb-4 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]"
          id="compare-seams-heading"
        >
          Category seams
        </h2>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          {pages.map((page, index) => (
            <Link
              className={cn(
                "group/link grid grid-cols-1 gap-4 p-6 transition-colors hover-hover:bg-[var(--surface-hover)] max-md:gap-3 md:grid-cols-[minmax(0,132px)_minmax(0,1fr)_auto] md:items-start",
                index > 0 && "border-[var(--border)] border-t",
              )}
              href={page.path}
              key={page.slug}
            >
              <p className="font-mono text-[12px] text-[var(--text-muted)] uppercase tracking-[0.06em]">
                {page.eyebrow}
              </p>
              <div className="min-w-0">
                <h3 className="text-balance text-[18px] text-[var(--text-primary)] leading-[1.25] tracking-[-0.02em] md:text-[20px]">
                  {page.title}
                </h3>
                <p className="mt-2 text-[14px] text-[var(--text-secondary)] leading-[1.55]">
                  {page.description}
                </p>
              </div>
              <SimChevronArrow className="shrink-0 self-center md:self-start md:mt-1" />
            </Link>
          ))}
        </div>
      </section>

      <div
        className={cn(
          HOME_INSET,
          "mt-12 flex flex-wrap gap-2 border-[var(--border)] border-t pt-8",
        )}
      >
        {pages.map((page) => (
          <ChipLink href={page.path} key={page.slug} variant="outline">
            {page.eyebrow}
          </ChipLink>
        ))}
        <SimCtaLink href="/product" variant="outline" withArrow>
          See the register
        </SimCtaLink>
      </div>
    </main>
  );
}
