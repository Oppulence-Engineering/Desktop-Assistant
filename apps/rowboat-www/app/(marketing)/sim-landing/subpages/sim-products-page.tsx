import { JsonLd } from "../../marketing-primitives";
import { breadcrumbJsonLd } from "../../metadata";
import { SimSolutionsProductPage, productsSuiteToSolutionsConfig } from "./solutions-product";
import { SimPageFooterRule } from "./sim-subpage-hero";

/** Sim solutions-style product suite hub — live previews like sim.ai `/platform`. */
export function SimProductsPage() {
  const config = productsSuiteToSolutionsConfig();

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Products", path: "/products" },
        ])}
      />
      <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
        <SimSolutionsProductPage config={config} />
        <SimPageFooterRule />
      </div>
    </>
  );
}
