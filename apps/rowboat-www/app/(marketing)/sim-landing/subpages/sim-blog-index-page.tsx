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

export type SimBlogPostItem = {
  slug: string;
  href: string;
  title: string;
  description?: string;
  category: string;
  date: string;
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Sim editorial list rows — blog index and category filters. */
export function SimBlogList({ posts }: { posts: SimBlogPostItem[] }) {
  return (
    <div>
      {posts.map((post) => (
        <div key={post.slug}>
          <Link
            className="group/link flex items-start gap-6 px-6 py-5 transition-colors hover-hover:bg-[var(--surface-hover)] md:items-center"
            href={post.href}
          >
            <span className="hidden w-[120px] shrink-0 pt-1 text-[var(--text-secondary)] text-[11px] uppercase tracking-[0.08em] md:block">
              {formatDate(post.date)}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-[0.08em] md:hidden">
                {formatDate(post.date)} · {post.category}
              </span>
              <h3 className="text-[var(--text-primary)] text-sm leading-snug tracking-[-0.02em] md:text-[15px]">
                {post.title}
              </h3>
              {post.description ? (
                <p className="line-clamp-2 text-[var(--text-muted)] text-[12px] leading-[150%] md:text-[13px]">
                  {post.description}
                </p>
              ) : null}
            </div>
            <SimChevronArrow className="mt-1 shrink-0 md:mt-0" />
          </Link>
          <div className="h-px w-full bg-[var(--border)]" />
        </div>
      ))}
    </div>
  );
}

/** Sim blog index / category page shell. */
export function SimBlogIndexPage({
  eyebrow,
  title,
  description,
  categories,
  posts,
  listHeading,
}: {
  eyebrow: string;
  title: string;
  description: string;
  categories: { label: string; href: string }[];
  posts: SimBlogPostItem[];
  listHeading: string;
}) {
  return (
    <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <SimSubpageHero
          description={description}
          eyebrow={eyebrow}
          title={title}
          titleId="blog-heading"
        />
        {categories.length > 0 ? (
          <nav aria-label="Blog categories" className="mt-6 flex flex-wrap gap-2">
            {categories.map((category) => (
              <Link
                className="rounded-full border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]"
                href={category.href}
                key={category.href}
              >
                {category.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <SimPageDivider />

      <SimBorderedColumn>
        <section aria-labelledby="blog-list-heading" className="pt-10">
          <h2
            className="mb-4 px-6 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]"
            id="blog-list-heading"
          >
            {listHeading}
          </h2>
          <SimBlogList posts={posts} />
        </section>
      </SimBorderedColumn>

      <SimPageFooterRule />
    </div>
  );
}
