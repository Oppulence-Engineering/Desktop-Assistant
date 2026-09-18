import { guidePages, indexCopy } from "../catalog";
import { CatalogIndex } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Guides",
  description: indexCopy.guides.description,
  path: "/guides",
});

export default function GuidesIndexPage() {
  return (
    <CatalogIndex
      description={indexCopy.guides.description}
      eyebrow="[guides]"
      items={guidePages.map((page) => ({
        href: page.path,
        title: page.title,
        body: page.description,
      }))}
      title={indexCopy.guides.title}
    />
  );
}
