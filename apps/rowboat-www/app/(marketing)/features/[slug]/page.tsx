import type { Metadata } from "next";

import { CatalogSlugRoute, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("feature");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("feature", slug);
}

export default function FeatureSlugPage({ params }: PageProps) {
  return <CatalogSlugRoute kind="feature" params={params} />;
}
