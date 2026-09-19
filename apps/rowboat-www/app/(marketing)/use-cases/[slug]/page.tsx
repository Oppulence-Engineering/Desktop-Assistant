import type { Metadata } from "next";

import { CatalogSlugRoute, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("use-case");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("use-case", slug);
}

export default function UseCaseSlugPage({ params }: PageProps) {
  return <CatalogSlugRoute kind="use-case" params={params} />;
}
