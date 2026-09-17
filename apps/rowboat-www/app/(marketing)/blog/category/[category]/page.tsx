import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@oppulence/ui/components/badge";

import {
  blogCategories,
  blogPostSlug,
  blogPostsInCategory,
  isBlogCategory,
} from "@/lib/content/editorial";

import { MarketingBreadcrumbs } from "../../../marketing-primitives";
import { marketingMetadata } from "../../../metadata";

export const instant = false;

export function generateStaticParams() {
  return blogCategories.map((category) => ({ category }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!isBlogCategory(category)) return { title: "Page not found — Oppulence" };
  return marketingMetadata({
    title: `${category} notes`,
    description: `Oppulence editorial notes in the ${category} category.`,
    path: `/blog/category/${category}`,
  });
}

export default async function BlogCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!isBlogCategory(category)) notFound();
  const posts = blogPostsInCategory(category);

  return (
    <div className="mk-article linear-subpage">
      <div className="linear-inset">
        <MarketingBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Blog", href: "/blog" },
            { label: category },
          ]}
        />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[blog / {category}]</p>
            <h1 className="linear-subpage-title mt-4">{category}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>
              {posts.length === 0
                ? "No published notes in this category yet."
                : `${posts.length} published note${posts.length === 1 ? "" : "s"}.`}
            </p>
          </div>
        </header>
        <section className="mk-blog-list">
          {posts.map((post) => {
            const slug = blogPostSlug(post);
            return (
              <Link href={`/blog/${slug}`} key={slug}>
                <Badge className="rounded-none" variant="outline">
                  {post.category}
                </Badge>
                <strong>{post.title}</strong>
                <em>{post.description}</em>
                <time dateTime={post.date}>{post.date}</time>
              </Link>
            );
          })}
        </section>
      </div>
    </div>
  );
}
