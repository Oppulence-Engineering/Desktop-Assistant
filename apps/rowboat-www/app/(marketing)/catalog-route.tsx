import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import type { CapabilityPage } from "./catalog";
import { allCapabilityPages, getCapabilityPage } from "./catalog";
import { CapabilityTemplate } from "./capability-page";
import { marketingMetadata } from "./metadata";

export function catalogStaticParams(kind: CapabilityPage["kind"]) {
  return allCapabilityPages
    .filter((page) => page.kind === kind)
    .map((page) => ({
      slug: page.slug,
    }));
}

export function catalogMetadata(kind: CapabilityPage["kind"], slug: string) {
  const page = getCapabilityPage(kind, slug);
  if (!page) {
    return { title: "Page not found — Oppulence" };
  }
  return marketingMetadata({
    title: page.title,
    description: page.description,
    path: page.path,
  });
}

export async function CatalogSlugPage({
  kind,
  slug,
}: {
  kind: CapabilityPage["kind"];
  slug: string;
}) {
  "use cache";
  cacheLife("days");
  const page = getCapabilityPage(kind, slug);
  if (!page) notFound();
  return <CapabilityTemplate page={page} />;
}

/**
 * Keep `params` out of the page default export so the marketing App Shell
 * stays prefetchable. The cached renderer only sees a resolved slug.
 */
export function CatalogSlugRoute({
  kind,
  params,
}: {
  kind: CapabilityPage["kind"];
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <CatalogSlugFromParams kind={kind} params={params} />
    </Suspense>
  );
}

async function CatalogSlugFromParams({
  kind,
  params,
}: {
  kind: CapabilityPage["kind"];
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CatalogSlugPage kind={kind} slug={slug} />;
}
