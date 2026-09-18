import { guidePages, indexCopy } from "../catalog";
import { SimResourcesPage } from "../sim-landing/subpages/sim-resources-page";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Resources",
  description: indexCopy.resources.description,
  path: "/resources",
});

export default function ResourcesPage() {
  return (
    <SimResourcesPage
      description={indexCopy.resources.description}
      guideItems={guidePages.map((page) => ({
        href: page.path,
        title: page.title,
        body: page.description,
      }))}
      heading={indexCopy.resources.title}
    />
  );
}
