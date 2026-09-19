import type { Metadata } from "next";
import { cacheLife } from "next/cache";

import { SimBillingStatusPage } from "../../sim-landing/subpages/sim-billing-status-page";

const TITLE = "Checkout cancelled — Oppulence";
const DESCRIPTION = "Stripe sends customers here when they leave checkout before they pay.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://oppulence.io/billing/cancel" },
  robots: { index: false, follow: false },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://oppulence.io/billing/cancel",
  },
};

export default async function BillingCancelRoute() {
  "use cache";
  cacheLife("days");

  return (
    <SimBillingStatusPage
      actions={[
        { href: "/pricing", label: "See the plans" },
        { href: "/app", label: "Go to the app", variant: "outline" },
      ]}
      description="You left checkout before you paid. We did not charge you, and your plan did not change."
      noteBody="You can start again at any time, or keep your current plan."
      noteTitle="Nothing changed"
      title="Checkout cancelled"
    />
  );
}
