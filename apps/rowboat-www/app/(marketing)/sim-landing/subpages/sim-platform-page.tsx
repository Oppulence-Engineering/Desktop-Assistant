import type { PlatformPage } from "../../marketing-data";
import { SimSolutionsProductPage, platformToSolutionsConfig } from "./solutions-product";
import { SimPageFooterRule } from "./sim-subpage-hero";

/** Sim solutions-style product page — web, desktop, or voice. Body matches sim.ai module pages. */
export function SimPlatformPage({ page }: { page: PlatformPage }) {
  const config = platformToSolutionsConfig(page);

  return (
    <div className="bg-[var(--bg)] pb-16 max-sm:pb-12">
      <SimSolutionsProductPage config={config} />
      <SimPageFooterRule />
    </div>
  );
}
