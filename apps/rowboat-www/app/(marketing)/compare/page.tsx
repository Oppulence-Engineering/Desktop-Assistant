import { comparePages } from "../compare-catalog";
import { CatalogIndex } from "../marketing-primitives";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Compare Oppulence",
  description:
    "How the commitment ledger sits next to a CRM, an inbox, a meeting recorder, and a generic assistant. No invented competitor scorecards.",
  path: "/compare",
});

export default function CompareIndexPage() {
  return (
    <div className="mk-index linear-subpage">
      <CatalogIndex
        description="These pages exist because the jobs overlap in conversation and not in the product. We will not publish a dozen generic alternative essays to chase help-center keywords."
        eyebrow="[compare]"
        items={comparePages.map((page) => ({
          href: page.path,
          title: page.eyebrow,
          body: page.description,
        }))}
        title="What Oppulence is not, and what it sits next to."
      />
    </div>
  );
}
