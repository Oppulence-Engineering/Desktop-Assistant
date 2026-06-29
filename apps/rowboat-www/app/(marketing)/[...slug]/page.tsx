import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  BlogArticlePage,
  BlogIndexPage,
  CustomerIndexPage,
  CustomerStoryPage,
  DemoPage,
  GenericPage,
  LegalPage,
  PricingPage,
} from "../marketing-components";
import { getMarketingPage, marketingPaths } from "../marketing-data";

type PageProps = {
  params: Promise<{ slug: string[] }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return marketingPaths.map((path) => ({
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

  return {
    title: `${page.eyebrow} - Oppulence`,
    description: page.description,
  };
}

export default async function Page(props: PageProps) {
  const { slug } = await props.params;
  const page = getMarketingPage(slug.join("/"));

  if (!page) {
    notFound();
  }

  if (page.path === "pricing") {
    return <PricingPage page={page} />;
  }

  if (page.path === "blog") {
    return <BlogIndexPage page={page} />;
  }

  if (page.path.startsWith("blog/")) {
    return <BlogArticlePage page={page} />;
  }

  if (page.path === "customers") {
    return <CustomerIndexPage page={page} />;
  }

  if (page.path.startsWith("customers/")) {
    return <CustomerStoryPage page={page} />;
  }

  if (page.path.startsWith("book-a-demo")) {
    return <DemoPage page={page} />;
  }

  if (page.path.startsWith("legal/")) {
    return <LegalPage page={page} />;
  }

  return <GenericPage page={page} />;
}
