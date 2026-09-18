import { notFound } from "next/navigation";

import {
  blogCategories,
  blogPostSlug,
  blogPostsInCategory,
  isBlogCategory,
} from "@/lib/content/editorial";

import { SimBlogIndexPage } from "../../../sim-landing/subpages/sim-blog-index-page";
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
    <SimBlogIndexPage
      categories={blogCategories.map((item) => ({
        label: item,
        href: `/blog/category/${item}`,
      }))}
      description={
        posts.length === 0
          ? "No published notes in this category yet."
          : `${posts.length} published note${posts.length === 1 ? "" : "s"}.`
      }
      eyebrow={`[blog / ${category}]`}
      listHeading={`${category} notes`}
      posts={posts.map((post) => {
        const slug = blogPostSlug(post);
        return {
          slug,
          href: `/blog/${slug}`,
          title: post.title,
          description: post.description,
          category: post.category,
          date: post.date,
        };
      })}
      title={category}
    />
  );
}
