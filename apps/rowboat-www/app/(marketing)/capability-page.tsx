import type { CapabilityPage } from "./catalog";
import { SimCapabilityPage } from "./sim-landing/subpages/sim-capability-page";

/** @deprecated Use {@link SimCapabilityPage} directly from route files. */
export function CapabilityTemplate({ page }: { page: CapabilityPage }) {
  return <SimCapabilityPage page={page} />;
}
