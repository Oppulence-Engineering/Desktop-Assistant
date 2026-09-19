import type { MarketingPage } from "../../marketing-data";
import { JsonLd } from "../../marketing-primitives";
import { breadcrumbJsonLd } from "../../metadata";
import { SimSolutionsProductPage, productToSolutionsConfig } from "./solutions-product";
import { SimPageFooterRule } from "./sim-subpage-hero";

/** Sim platform-style core product page — `/product`. */
export function SimProductPage({ page }: { page: MarketingPage }) {
  const config = productToSolutionsConfig(page);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Product", path: "/product" },
        ])}
      />
      <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
        <SimSolutionsProductPage config={config} />
        <SimPageFooterRule />
      </div>
    </>
  );
}
