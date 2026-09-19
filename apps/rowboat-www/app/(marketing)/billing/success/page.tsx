import type { Metadata } from "next";
import { cacheLife } from "next/cache";

import { SimBillingStatusPage } from "../../sim-landing/subpages/sim-billing-status-page";

const TITLE = "Subscription confirmed — Oppulence";
const DESCRIPTION = "Stripe sends customers here after they pay for an Oppulence plan.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://oppulence.io/billing/success" },
  robots: { index: false, follow: false },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://oppulence.io/billing/success",
  },
};

export default async function BillingSuccessRoute() {
  "use cache";
  cacheLife("days");

  return (
    <SimBillingStatusPage
      actions={[
        { href: "/app/settings", label: "Open settings" },
        { href: "/app", label: "Go to the app", variant: "outline" },
      ]}
      description="Thank you. Your payment went through, and your plan is now active on your account. Stripe sends the receipt to your email address."
      noteBody="Your plan can take a few seconds to appear in the app. Reload the settings page if you do not see it yet."
      noteTitle="If the plan is not visible yet"
      title="Your subscription is active"
    />
  );
}
