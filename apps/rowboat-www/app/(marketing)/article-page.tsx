import type { ReactNode } from "react";

import { SimEditorialArticle } from "./sim-landing/subpages/sim-editorial-article";

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
  return (
    <SimEditorialArticle
      category={category}
      categoryHref={categoryHref}
      crumbs={crumbs}
      date={date}
      description={description}
      eyebrow={eyebrow}
      path={path}
      related={related}
      title={title}
    >
      {children}
    </SimEditorialArticle>
  );
}
