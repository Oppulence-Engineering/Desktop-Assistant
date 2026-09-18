import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/sim/cn";

import { JsonLd, RelatedPages } from "../../marketing-primitives";
import { articleJsonLd, breadcrumbJsonLd } from "../../metadata";
import {
  SimBorderedColumn,
  SimPageDivider,
  SimPageFooterRule,
  SimSubpageHero,
} from "./sim-subpage-hero";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";

/** Sim editorial article layout — prose in bordered column. */
export function SimEditorialArticle({
  title,
  description,
  path,
  eyebrow,
  date,
  category,
  categoryHref,
  children,
  related,
  crumbs,
}: {
  title: string;
  description: string;
  path: string;
  eyebrow: string;
  date?: string;
  category?: string;
  categoryHref?: string;
  children: ReactNode;
  related?: { label: string; href: string; description?: string }[];
  crumbs?: { name: string; path: string }[];
}) {
  const trail = crumbs ?? [
    { name: "Home", path: "/" },
    { name: "Blog", path: "/blog" },
    { name: title, path },
  ];

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(trail)} />
      <JsonLd data={articleJsonLd({ title, description, path })} />
      <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
        <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <nav aria-label="Breadcrumb" className="mb-6 text-[12px] text-[var(--text-secondary)]">
            <ol className="flex flex-wrap items-center gap-2">
              {trail.map((item, index) => (
                <li className="flex items-center gap-2" key={item.path}>
                  {index > 0 ? <span aria-hidden="true">/</span> : null}
                  {index === trail.length - 1 ? (
                    <span className="text-[var(--text-primary)]">{item.name}</span>
                  ) : (
                    <Link className="hover:text-[var(--text-primary)]" href={item.path}>
                      {item.name}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <SimSubpageHero
            description={description}
            eyebrow={`[${eyebrow}]`}
            title={title}
            titleId="article-heading"
          >
            <p className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--text-muted)]">
              {category && categoryHref ? (
                <Link className="hover:text-[var(--text-primary)]" href={categoryHref}>
                  {category}
                </Link>
              ) : null}
              {date ? <time dateTime={date}>{date}</time> : null}
            </p>
          </SimSubpageHero>
        </div>

        <SimPageDivider />

        <SimBorderedColumn>
          <div className="px-6 py-10">
            <div
              className={cn(
                "max-w-none text-[15px] text-[var(--text-body)] leading-[1.75]",
                "[&_a]:text-[var(--text-primary)] [&_a]:underline-offset-4 hover:[&_a]:underline",
                "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-[20px] [&_h2]:text-[var(--text-primary)]",
                "[&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-[17px] [&_h3]:text-[var(--text-primary)]",
                "[&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5",
                "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5",
              )}
            >
              {children}
            </div>
          </div>
        </SimBorderedColumn>

        {related && related.length > 0 ? (
          <div className={cn("mt-10", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
            <RelatedPages items={related} />
          </div>
        ) : null}

        <SimPageFooterRule />
      </div>
    </>
  );
}
