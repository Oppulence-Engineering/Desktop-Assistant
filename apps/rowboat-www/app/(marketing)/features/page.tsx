import { cacheLife } from "next/cache";

import { featurePages, indexCopy } from "../catalog";
import { SimCatalogHub } from "../sim-landing/subpages/sim-catalog-hub";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Features",
  description: indexCopy.features.description,
  path: "/features",
});

export default async function FeaturesIndexPage() {
  "use cache";
  cacheLife("days");

  return (
    <SimCatalogHub
      description={indexCopy.features.description}
      eyebrow="[features]"
      heading={indexCopy.features.title}
      items={featurePages.map((page) => ({
        href: page.path,
        title: page.eyebrow,
        body: page.description,
      }))}
      listHeading="All features"
    />
  );
}
