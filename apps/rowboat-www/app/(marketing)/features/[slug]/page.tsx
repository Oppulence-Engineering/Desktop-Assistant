import type { Metadata } from "next";

import { CatalogSlugPage, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("feature");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("feature", slug);
}

export default async function FeatureSlugPage({ params }: PageProps) {
  const { slug } = await params;
  return <CatalogSlugPage kind="feature" slug={slug} />;
}
