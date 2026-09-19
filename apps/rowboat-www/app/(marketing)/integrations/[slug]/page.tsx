import type { Metadata } from "next";

import { CatalogSlugRoute, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("integration");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("integration", slug);
}

export default function IntegrationSlugPage({ params }: PageProps) {
  return <CatalogSlugRoute kind="integration" params={params} />;
}
