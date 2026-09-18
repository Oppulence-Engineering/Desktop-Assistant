import { indexCopy, useCasePages } from "../catalog";
import { CatalogIndex } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Use cases",
  description: indexCopy.useCases.description,
  path: "/use-cases",
});

export default function UseCasesIndexPage() {
  return (
    <CatalogIndex
      description={indexCopy.useCases.description}
      eyebrow="[use cases]"
      items={useCasePages.map((page) => ({
        href: page.path,
        title: page.eyebrow,
        body: page.description,
      }))}
      title={indexCopy.useCases.title}
    />
  );
}
