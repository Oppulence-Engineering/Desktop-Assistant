import { cacheLife } from "next/cache";

import { indexCopy, useCasePages } from "../catalog";
import { SimCatalogHub } from "../sim-landing/subpages/sim-catalog-hub";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Use cases",
  description: indexCopy.useCases.description,
  path: "/use-cases",
});

export default async function UseCasesIndexPage() {
  "use cache";
  cacheLife("days");

  return (
    <SimCatalogHub
      description={indexCopy.useCases.description}
      eyebrow="[use cases]"
      heading={indexCopy.useCases.title}
      items={useCasePages.map((page) => ({
        href: page.path,
        title: page.eyebrow,
        body: page.description,
      }))}
      listHeading="All use cases"
    />
  );
}
