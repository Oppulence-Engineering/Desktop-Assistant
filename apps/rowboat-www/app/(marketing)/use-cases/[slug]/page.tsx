import type { Metadata } from "next";

import { CatalogSlugPage, catalogMetadata, catalogStaticParams } from "../../catalog-route";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return catalogStaticParams("use-case");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return catalogMetadata("use-case", slug);
}

export default async function UseCaseSlugPage({ params }: PageProps) {
  const { slug } = await params;
  return <CatalogSlugPage kind="use-case" slug={slug} />;
}
