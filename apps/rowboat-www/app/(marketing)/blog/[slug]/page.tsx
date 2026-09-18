import { notFound } from "next/navigation";

import { blogPostSlug, publishedBlogPost, publishedBlogPosts } from "@/lib/content/editorial";

import { BlogArticlePage } from "../../marketing-components";
import { blogPages, getMarketingPage } from "../../marketing-data";
import { marketingMetadata } from "../../metadata";
import { EditorialArticle } from "../../article-page";
import { MarkdownBody } from "../../render-markdown";

export const instant = false;

export function generateStaticParams() {
  const editorial = publishedBlogPosts().map((post) => blogPostSlug(post));
  const archive = blogPages.map((page) => page.path.replace(/^blog\//, ""));
  return [...new Set([...editorial, ...archive])].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = publishedBlogPost(slug);
  if (post) {
    return marketingMetadata({
      title: post.title,
      description: post.description ?? post.title,
      path: `/blog/${slug}`,
    });
  }
  const archive = getMarketingPage(`blog/${slug}`);
  if (archive) {
    return marketingMetadata({
      title: archive.title,
      description: archive.description,
      path: `/${archive.path}`,
    });
  }
  return { title: "Page not found — Oppulence" };
}

export default async function BlogSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = publishedBlogPost(slug);
  if (post) {
    const raw = await post.getText("raw");
    return (
      <EditorialArticle
        category={post.category}
        categoryHref={`/blog/category/${post.category}`}
        date={post.date}
        description={post.description ?? ""}
        eyebrow={post.category}
        path={`/blog/${slug}`}
        related={[
          { label: "All notes", href: "/blog", description: "The editorial index." },
          { label: "Guides", href: "/guides", description: "Evergreen product decisions." },
        ]}
        title={post.title}
      >
        <MarkdownBody raw={raw} />
      </EditorialArticle>
    );
  }

  const archive = getMarketingPage(`blog/${slug}`);
  if (archive) {
    return <BlogArticlePage page={archive} />;
  }

  notFound();
}
