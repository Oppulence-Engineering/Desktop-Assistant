import { cacheLife } from "next/cache";

import { indexCopy, integrationPages } from "../catalog";
import { SimCatalogHub } from "../sim-landing/subpages/sim-catalog-hub";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Integrations",
  description: indexCopy.integrations.description,
  path: "/integrations",
});

export default async function IntegrationsIndexPage() {
  "use cache";
  cacheLife("days");

  return (
    <SimCatalogHub
      description={indexCopy.integrations.description}
      eyebrow="[integrations]"
      heading={indexCopy.integrations.title}
      items={integrationPages.map((page) => ({
        href: page.path,
        title: page.eyebrow,
        body: page.description,
      }))}
      listHeading="First-party connectors"
    />
  );
}
