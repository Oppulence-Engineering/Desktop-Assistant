import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { blogPostSlug, publishedBlogPost, publishedBlogPosts } from "@/lib/content/editorial";

import { blogPages, getMarketingPage } from "../../marketing-data";
import { marketingMetadata } from "../../metadata";
import { EditorialArticle } from "../../article-page";
import { MarkdownBody } from "../../render-markdown";
import { alternativeFromSlug } from "../../seo-theme";
import { SimBlogArchivePage } from "../../sim-landing/subpages/sim-marketing-bullet-page";
import { SimSeoAlternativePage } from "../../sim-landing/subpages/sim-seo-alternative-page";

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

async function renderBlogSlug(slug: string) {
  "use cache";
  cacheLife("days");
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
    const alternative = alternativeFromSlug(slug);
    if (alternative) {
      return <SimSeoAlternativePage alternative={alternative} page={archive} />;
    }
    return <SimBlogArchivePage page={archive} />;
  }

  notFound();
}

export default function BlogSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <BlogSlugFromParams params={params} />
    </Suspense>
  );
}

async function BlogSlugFromParams({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderBlogSlug(slug);
}
