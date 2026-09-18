import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { featureDetails } from "../marketing-data";
import { getMarketingPage, marketingPaths } from "../marketing-data";
import { marketingMetadata } from "../metadata";
import { dedicatedMarketingPaths } from "../site";
import { getSeoLander } from "../seo-theme";
import { SimEditorialArticle } from "../sim-landing/subpages/sim-editorial-article";
import { SimFeatureMirrorPage } from "../sim-landing/subpages/sim-feature-mirror-page";
import { SimMarketingBulletPage } from "../sim-landing/subpages/sim-marketing-bullet-page";
import { SimSeoLanderPage } from "../sim-landing/subpages/sim-seo-lander-page";

type PageProps = {
  params: Promise<{ slug: string[] }>;
};

export const instant = false;

export function generateStaticParams() {
  const moved = new Set([
    ...dedicatedMarketingPaths,
    "pricing",
    "blog",
    "customers",
    "product",
    "guides",
    "resources",
    "changelog",
    "answers",
  ]);
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

  const lander = getSeoLander(page.path);
  if (lander) {
    return <SimSeoLanderPage lander={lander} page={page} />;
  }

  const details =
    featureDetails[page.path] ??
    (page.path === "lp/ai-help-center" ? featureDetails["ai-help-center"] : undefined);
  if (details) {
    return <SimFeatureMirrorPage details={details} page={page} />;
  }

  if (page.path.startsWith("legal/")) {
    return (
      <SimEditorialArticle
        crumbs={[
          { name: "Home", path: "/" },
          { name: page.eyebrow, path: `/${page.path}` },
        ]}
        description={page.description}
        eyebrow={page.eyebrow}
        path={`/${page.path}`}
        title={page.title}
      >
        {page.bullets.map((bullet) => (
          <p key={bullet}>{bullet}</p>
        ))}
        <p>
          This route is intentionally present for launch-readiness and should be reviewed by counsel
          before production use.
        </p>
      </SimEditorialArticle>
    );
  }

  return <SimMarketingBulletPage page={page} />;
}
