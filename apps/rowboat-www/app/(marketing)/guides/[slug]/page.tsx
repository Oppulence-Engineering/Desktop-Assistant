import type { Metadata } from "next";

import { CatalogSlugPage, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("guide");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("guide", slug);
}

export default async function GuideSlugPage({ params }: PageProps) {
  const { slug } = await params;
  return <CatalogSlugPage kind="guide" slug={slug} />;
}
