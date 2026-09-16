import type { Metadata } from "next";
import Link from "next/link";

const TITLE = "Checkout cancelled — Oppulence";
const DESCRIPTION = "Stripe sends customers here when they leave checkout before they pay.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://oppulence.io/billing/cancel" },
  // A checkout return page belongs to one customer, so search engines skip it.
  robots: { index: false, follow: false },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://oppulence.io/billing/cancel",
  },
};

export default function BillingCancelRoute() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-20">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Billing
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">Checkout cancelled</h1>
      <p className="text-[15px] leading-relaxed text-foreground/78">
        You left checkout before you paid. We did not charge you, and your plan did not change.
      </p>
      <section className="marketing-surface flex flex-col gap-3 border p-5">
        <p className="text-[13px] leading-relaxed text-foreground/78">
          You can start again at any time, or keep your current plan.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className="text-sm font-medium underline underline-offset-4" href="/pricing">
            See the plans
          </Link>
          <Link className="text-sm font-medium underline underline-offset-4" href="/app">
            Go to the app
          </Link>
        </div>
      </section>
    </main>
  );
}
