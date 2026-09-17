import Link from "next/link";

import { Badge } from "@oppulence/ui/components/badge";

import { blogCategories, blogPostSlug, publishedBlogPosts } from "@/lib/content/editorial";

import { MarketingBreadcrumbs } from "../marketing-primitives";
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
    <div className="mk-article linear-subpage">
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Blog" }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[blog]</p>
            <h1 className="linear-subpage-title mt-4">
              Notes from the people who built the register.
            </h1>
          </div>
          <div className="linear-subpage-description">
            <p>
              Fumadocs MDX in this repo. Categories are product, workflow, security, and install.
              Older help-center comparison URLs still resolve; they are not this index.
            </p>
          </div>
        </header>
        <nav aria-label="Blog categories" className="mk-blog-cats">
          {blogCategories.map((category) => (
            <Link href={`/blog/category/${category}`} key={category}>
              {category}
            </Link>
          ))}
        </nav>
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
