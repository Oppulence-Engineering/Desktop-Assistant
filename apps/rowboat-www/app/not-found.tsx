import { MarketingLayout, NotFoundMarketingPage } from "./(marketing)/marketing-components";

/**
 * Root 404 for routes outside the marketing group. Marketing 404s use the
 * segment-level page so the public shell is not rendered twice.
 */
export default function NotFound() {
  return (
    <MarketingLayout>
      <NotFoundMarketingPage />
    </MarketingLayout>
  );
}
