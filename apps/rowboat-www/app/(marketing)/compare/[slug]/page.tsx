import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { comparePages, getComparePage } from "../../compare-catalog";
import { CompareTemplate } from "../../compare-page";
import { marketingMetadata } from "../../metadata";

export function generateStaticParams() {
  return comparePages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getComparePage(slug);
  if (!page) return { title: "Page not found — Oppulence" };
  return marketingMetadata({
    title: page.title,
    description: page.description,
    path: page.path,
  });
}

async function renderCompareSlug(slug: string) {
  "use cache";
  cacheLife("days");
  const page = getComparePage(slug);
  if (!page) notFound();
  return <CompareTemplate page={page} />;
}

export default function CompareSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <CompareSlugFromParams params={params} />
    </Suspense>
  );
}

async function CompareSlugFromParams({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderCompareSlug(slug);
}
