import { blogCategories, blogPostSlug, publishedBlogPosts } from "@/lib/content/editorial";

import { SimBlogIndexPage } from "../sim-landing/subpages/sim-blog-index-page";
import { marketingMetadata } from "../metadata";

export const instant = false;

export const metadata = marketingMetadata({
  title: "Blog",
  description:
    "Editorial notes on the commitment ledger, approval, install, and what stays on the machine. Written from the product, not from leftover help-center keywords.",
  path: "/blog",
});

export default function BlogIndexPage() {
  const posts = publishedBlogPosts();

  return (
    <SimBlogIndexPage
      categories={blogCategories.map((category) => ({
        label: category,
        href: `/blog/category/${category}`,
      }))}
      description="Fumadocs MDX in this repo. Categories are product, workflow, security, and install. Older help-center comparison URLs still resolve; they are not this index."
      eyebrow="[blog]"
      listHeading="Published notes"
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
      title="Notes from the people who built the register."
    />
  );
}
