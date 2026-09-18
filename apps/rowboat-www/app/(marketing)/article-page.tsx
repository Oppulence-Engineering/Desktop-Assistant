import Link from "next/link";
import type { ReactNode } from "react";

import { JsonLd, MarketingBreadcrumbs, MarketingCta, RelatedPages } from "./marketing-primitives";
import { articleJsonLd, breadcrumbJsonLd } from "./metadata";

export function EditorialArticle({
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
  // Blog is the default trail. Customer stories pass their own so the
  // unpublished-until-real collection does not inherit a blog breadcrumb.
  const trail = crumbs ?? [
    { name: "Home", path: "/" },
    { name: "Blog", path: "/blog" },
    { name: title, path },
  ];

  return (
    <article className="mk-article linear-subpage">
      <JsonLd data={breadcrumbJsonLd(trail)} />
      <JsonLd data={articleJsonLd({ title, description, path })} />
      <div className="linear-inset">
        <MarketingBreadcrumbs
          items={trail.map((item, index) =>
            index === trail.length - 1
              ? { label: item.name }
              : { label: item.name, href: item.path },
          )}
        />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[{eyebrow}]</p>
            <h1 className="linear-subpage-title mt-4">{title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{description}</p>
            <p className="mk-article-meta">
              {category && categoryHref ? <Link href={categoryHref}>{category}</Link> : null}
              {date ? <time dateTime={date}>{date}</time> : null}
            </p>
          </div>
        </header>
        <div className="mk-article-body">{children}</div>
        {related && related.length > 0 ? <RelatedPages items={related} /> : null}
        <MarketingCta title="Read it against your own mail." />
      </div>
    </article>
  );
}
