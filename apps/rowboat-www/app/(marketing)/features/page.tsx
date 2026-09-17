import { featurePages, indexCopy } from "../catalog";
import { CatalogIndex } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Features",
  description: indexCopy.features.description,
  path: "/features",
});

export default function FeaturesIndexPage() {
  return (
    <CatalogIndex
      description={indexCopy.features.description}
      eyebrow="[features]"
      items={featurePages.map((page) => ({
        href: page.path,
        title: page.eyebrow,
        body: page.description,
      }))}
      title={indexCopy.features.title}
    />
  );
}
