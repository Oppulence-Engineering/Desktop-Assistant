import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { SimChevronArrow } from "../chevron-arrow";
import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SIM_SURFACE_CARD } from "./sim-surface-card";

export type SimCustomerStoryItem = {
  slug: string;
  href: string;
  title: string;
  description?: string;
  company: string;
};

/** Sim customers index — honest empty state or published story rows. No logo carousel. */
export function SimCustomersIndexPage({ stories }: { stories: SimCustomerStoryItem[] }) {
  const hasStories = stories.length > 0;

  return (
    <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <SimSubpageHero
          description="The public site already knows how to render a story: company, role, approved quote, and MDX body via Fumadocs. A file is published only when published is true. Until then this index stays empty."
          eyebrow="[customers]"
          title={
            hasStories
              ? "Stories from operators using the register."
              : "Customer stories will live here. Not invented ones."
          }
          titleId="customers-heading"
        />
      </div>

      <SimPageDivider />

      <SimBorderedColumn>
        {hasStories ? (
          <section aria-labelledby="customers-list-heading" className="pt-10">
            <h2
              className="mb-4 px-6 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
              id="customers-list-heading"
            >
              Published stories
            </h2>
            <div>
              {stories.map((story) => (
                <div key={story.slug}>
                  <Link
                    className="group/link flex items-start gap-6 px-6 py-5 transition-colors hover-hover:bg-[var(--surface-hover)] md:items-center"
                    href={story.href}
                  >
                    <span className="hidden w-[120px] shrink-0 text-[11px] text-[var(--text-secondary)] uppercase tracking-[0.08em] md:block">
                      {story.company}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.08em] md:hidden">
                        {story.company}
                      </span>
                      <h3 className="text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em] md:text-[15px]">
                        {story.title}
                      </h3>
                      {story.description ? (
                        <p className="line-clamp-2 text-[var(--text-muted)] text-[12px] leading-[150%] md:text-[13px]">
                          {story.description}
                        </p>
                      ) : null}
                    </div>
                    <SimChevronArrow className="mt-1 shrink-0 md:mt-0" />
                  </Link>
                  <div className="h-px w-full bg-[var(--border)]" />
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="px-6 py-10">
            <div className={cn(SIM_SURFACE_CARD, "flex flex-col gap-3 p-6")}>
              <p className="text-[15px] text-[var(--text-body)] leading-[1.55]">
                Add an approved write-up under{" "}
                <code className="text-[13px]">content/customers</code>. Do not invent a company, a
                logo, or a time-saved number to fill this page.
              </p>
              <Link
                className="text-[14px] text-[var(--text-body)] underline-offset-4 hover:underline"
                href="/sign-up"
              >
                Start with the free report
              </Link>
            </div>
          </section>
        )}
      </SimBorderedColumn>

      <SimPageFooterRule />
    </div>
  );
}
