import type { Metadata } from "next";

import { CatalogSlugRoute, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("guide");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("guide", slug);
}

export default function GuideSlugPage({ params }: PageProps) {
  return <CatalogSlugRoute kind="guide" params={params} />;
}
