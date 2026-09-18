import type { Metadata } from "next";

import { CatalogSlugPage, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("integration");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("integration", slug);
}

export default async function IntegrationSlugPage({ params }: PageProps) {
  const { slug } = await params;
  return <CatalogSlugPage kind="integration" slug={slug} />;
}
