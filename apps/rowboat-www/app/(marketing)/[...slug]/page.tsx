import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GenericPage, LegalPage, ProductPage } from "../marketing-components";
import { getMarketingPage, marketingPaths } from "../marketing-data";
import { marketingMetadata } from "../metadata";
import { dedicatedMarketingPaths } from "../site";

type PageProps = {
  params: Promise<{ slug: string[] }>;
};

export const instant = false;

export function generateStaticParams() {
  const moved = new Set<string>([...dedicatedMarketingPaths, "pricing", "blog", "customers"]);
  return marketingPaths
    .filter(
      (path) => !moved.has(path) && !path.startsWith("blog/") && !path.startsWith("customers/"),
    )
    .map((path) => ({
      slug: path.split("/"),
    }));
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const page = getMarketingPage(slug.join("/"));

  if (!page) {
    return {
      title: "Page not found - Oppulence",
    };
  }

  return marketingMetadata({
    title: page.title,
    description: page.description,
    path: `/${page.path}`,
  });
}

export default async function Page(props: PageProps) {
  const { slug } = await props.params;
  const page = getMarketingPage(slug.join("/"));

  if (!page) {
    notFound();
  }

  if (page.path === "product") {
    return <ProductPage page={page} />;
  }

  if (page.path.startsWith("legal/")) {
    return <LegalPage page={page} />;
  }

  return <GenericPage page={page} />;
}
