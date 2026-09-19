import { cacheLife } from "next/cache";

import { comparePages } from "../compare-catalog";
import { SimCompareHub } from "../sim-landing/subpages/sim-compare-hub";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Compare Oppulence",
  description:
    "How the commitment ledger sits next to a CRM, an inbox, a meeting recorder, and a generic assistant. No invented competitor scorecards.",
  path: "/compare",
});

export default async function CompareIndexPage() {
  "use cache";
  cacheLife("days");

  return (
    <SimCompareHub
      description="These pages exist because the jobs overlap in conversation and not in the product. We will not publish a dozen generic alternative essays to chase help-center keywords."
      heading="What Oppulence is not, and what it sits next to."
      pages={comparePages}
    />
  );
}
