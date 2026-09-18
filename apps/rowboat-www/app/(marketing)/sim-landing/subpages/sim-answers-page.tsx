import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { JsonLd } from "../../marketing-primitives";
import { SimChevronArrow } from "../chevron-arrow";
import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import type { SimCatalogHubItem } from "./sim-catalog-hub";

function SimCatalogRows({ items }: { items: SimCatalogHubItem[] }) {
  return (
    <div>
      {items.map((item) => (
        <div key={item.href}>
          <Link
            aria-label={item.title}
            className="group/link flex items-center gap-4 px-6 py-4 transition-colors hover-hover:bg-[var(--surface-hover)]"
            href={item.href}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 className="text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em]">
                {item.title}
              </h3>
              <p className="hidden text-[var(--text-muted)] text-[12px] leading-[150%] sm:line-clamp-1">
                {item.body}
              </p>
            </div>
            <SimChevronArrow />
          </Link>
          <div className="h-px w-full bg-[var(--border)]" />
        </div>
      ))}
    </div>
  );
}

/** Sim answer hub — leftover SEO definitions plus alternative queries. */
export function SimAnswersPage({
  description,
  answerItems,
  alternativeItems,
  itemListJsonLd,
}: {
  description: string;
  answerItems: SimCatalogHubItem[];
  alternativeItems: SimCatalogHubItem[];
  itemListJsonLd: Record<string, unknown>;
}) {
  return (
    <>
      <JsonLd data={itemListJsonLd} />
      <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <SimSubpageHero
            description={description}
            eyebrow="[answers]"
            title="The leftover cluster, written as definitions."
            titleId="answers-heading"
          />
        </div>

        <SimPageDivider />

        <SimBorderedColumn>
          <section aria-labelledby="answers-list-heading" className="pt-10">
            <h2
              className="mb-4 px-6 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
              id="answers-list-heading"
            >
              Definition pages
            </h2>
            <SimCatalogRows items={answerItems} />
          </section>

          <div className="h-px w-full bg-[var(--border)]" />

          <section aria-labelledby="alternatives-list-heading" className="px-6 py-10">
            <p className="mb-2 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
              [alternatives]
            </p>
            <h2
              className="mb-2 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
              id="alternatives-list-heading"
            >
              Alternative queries, and the job they do not do.
            </h2>
            <p className="mb-4 max-w-[720px] text-[14px] text-[var(--text-muted)] leading-[150%]">
              These URLs keep alternative queries. They are not vendor rankings.
            </p>
            <SimCatalogRows items={alternativeItems} />
          </section>
        </SimBorderedColumn>

        <SimPageFooterRule />
      </div>
    </>
  );
}
