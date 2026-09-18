import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { SimChevronArrow } from "../chevron-arrow";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SimLandingFaq } from "../landing-faq";

export type SimCatalogHubItem = {
  href: string;
  title: string;
  body: string;
};

/** Sim comparisons / library index rhythm — bordered list with chevron rows. */
export function SimCatalogHub({
  eyebrow,
  heading,
  description,
  items,
  listHeading,
  faqs,
}: {
  eyebrow: string;
  heading: string;
  description: string;
  items: SimCatalogHubItem[];
  listHeading: string;
  faqs?: { question: string; answer: string }[];
}) {
  return (
    <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div aria-hidden="true" className="mb-6 h-6" />
        <div className="flex flex-col gap-4">
          <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
            {eyebrow}
          </p>
          <h1
            className="text-balance text-[28px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[40px]"
            id="catalog-hub-heading"
          >
            {heading}
          </h1>
          <p className="max-w-[720px] text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em] lg:text-base">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-8 h-px w-full bg-[var(--border)]" />

      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div className="border-[var(--border)] border-x">
          <section aria-labelledby="catalog-list-heading" className="pt-10">
            <h2
              className="mb-4 px-6 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
              id="catalog-list-heading"
            >
              {listHeading}
            </h2>
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
          </section>

          {faqs && faqs.length > 0 ? (
            <section aria-labelledby="catalog-faq-heading" className="px-6 py-10">
              <h2
                className="mb-4 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
                id="catalog-faq-heading"
              >
                Frequently asked questions
              </h2>
              <SimLandingFaq faqs={faqs} />
            </section>
          ) : null}
        </div>
      </div>

      <div className="-mt-px h-px w-full bg-[var(--border)]" />
    </div>
  );
}
