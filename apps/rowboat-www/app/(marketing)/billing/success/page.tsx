import type { Metadata } from "next";
import Link from "next/link";

const TITLE = "Subscription confirmed — Oppulence";
const DESCRIPTION = "Stripe sends customers here after they pay for an Oppulence plan.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://oppulence.io/billing/success" },
  // A checkout return page belongs to one customer, so search engines skip it.
  robots: { index: false, follow: false },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://oppulence.io/billing/success",
  },
};

export default function BillingSuccessRoute() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-20">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Billing
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">Your subscription is active</h1>
      <p className="text-[15px] leading-relaxed text-foreground/78">
        Thank you. Your payment went through, and your plan is now active on your account. Stripe
        sends the receipt to your email address.
      </p>
      <section className="marketing-surface flex flex-col gap-3 border p-5">
        <p className="text-[13px] leading-relaxed text-foreground/78">
          Your plan can take a few seconds to appear in the app. Reload the settings page if you do
          not see it yet.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className="text-sm font-medium underline underline-offset-4" href="/app/settings">
            Open settings
          </Link>
          <Link className="text-sm font-medium underline underline-offset-4" href="/app">
            Go to the app
          </Link>
        </div>
      </section>
    </main>
  );
}
