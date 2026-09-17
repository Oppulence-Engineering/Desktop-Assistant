import { indexCopy, integrationPages } from "../catalog";
import { CatalogIndex } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Integrations",
  description: indexCopy.integrations.description,
  path: "/integrations",
});

export default function IntegrationsIndexPage() {
  return (
    <CatalogIndex
      description={indexCopy.integrations.description}
      eyebrow="[integrations]"
      items={integrationPages.map((page) => ({
        href: page.path,
        title: page.eyebrow,
        body: page.description,
      }))}
      title={indexCopy.integrations.title}
    />
  );
}
