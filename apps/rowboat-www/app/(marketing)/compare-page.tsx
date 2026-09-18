import type { ComparePage } from "./compare-catalog";
import { SimCompareDetailPage } from "./sim-landing/subpages/sim-compare-detail";

/** @deprecated Use {@link SimCompareDetailPage} directly from route files. */
export function CompareTemplate({ page }: { page: ComparePage }) {
  return <SimCompareDetailPage page={page} />;
}
