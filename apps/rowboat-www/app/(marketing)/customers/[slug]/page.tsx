import { notFound } from "next/navigation";

import { customerStaticParams, publishedCustomerStory } from "@/lib/content/editorial";

import { EditorialArticle } from "../../article-page";
import { MarkdownBody } from "../../render-markdown";
import { marketingMetadata } from "../../metadata";

export const instant = false;

export function generateStaticParams() {
  return customerStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const story = publishedCustomerStory(slug);
  if (!story) return { title: "Page not found — Oppulence" };
  return marketingMetadata({
    title: story.title,
    description: story.description ?? story.title,
    path: `/customers/${slug}`,
  });
}

export default async function CustomerStoryRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const story = publishedCustomerStory(slug);
  if (!story) notFound();

  const raw = await story.getText("raw");
  return (
    <EditorialArticle
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Customers", path: "/customers" },
        { name: story.title, path: `/customers/${slug}` },
      ]}
      description={story.description ?? ""}
      eyebrow={story.company}
      path={`/customers/${slug}`}
      related={[
        { label: "All stories", href: "/customers", description: "Only published write-ups." },
        { label: "Product", href: "/product", description: "The ledger those stories use." },
      ]}
      title={story.title}
    >
      {story.quote ? <blockquote>{story.quote}</blockquote> : null}
      {story.role ? (
        <p>
          {story.role}
          {story.industry ? ` · ${story.industry}` : ""}
        </p>
      ) : null}
      <MarkdownBody raw={raw} />
    </EditorialArticle>
  );
}
