import { SimPricingPage } from "../sim-landing/subpages/sim-pricing-page";
import { marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Pricing",
  description:
    "Watch is a free 6-month report. Chase is the live register. Intelligence adds change history and export. Flat monthly. No seat tax.",
  path: "/pricing",
});

export default function PricingRoutePage() {
  return <SimPricingPage />;
}
