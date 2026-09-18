import { notFound } from "next/navigation";

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

export function CatalogSlugPage({ kind, slug }: { kind: CapabilityPage["kind"]; slug: string }) {
  const page = getCapabilityPage(kind, slug);
  if (!page) notFound();
  return <CapabilityTemplate page={page} />;
}
