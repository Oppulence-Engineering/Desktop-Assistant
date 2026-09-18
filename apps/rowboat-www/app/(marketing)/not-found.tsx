import { NotFoundMarketingPage } from "./marketing-components";

/**
 * Segment-level 404. The marketing group layout already supplies header and
 * footer, so this file must not wrap the public shell again.
 */
export default function MarketingNotFound() {
  return <NotFoundMarketingPage />;
}
