import { guidePages, indexCopy } from "../catalog";
import { SimCatalogHub } from "../sim-landing/subpages/sim-catalog-hub";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Guides",
  description: indexCopy.guides.description,
  path: "/guides",
});

export default function GuidesIndexPage() {
  return (
    <SimCatalogHub
      description={indexCopy.guides.description}
      eyebrow="[guides]"
      heading={indexCopy.guides.title}
      items={guidePages.map((page) => ({
        href: page.path,
        title: page.title,
        body: page.description,
      }))}
      listHeading="All guides"
    />
  );
}
