import type { Metadata } from "next";
import { cacheLife } from "next/cache";

import { SimProductsPage } from "../sim-landing/subpages/sim-products-page";

const DESCRIPTION =
  "The Oppulence product suite: the commitment ledger, web app, desktop app, voice app, and integrations that keep business promises visible.";

export const metadata: Metadata = {
  title: "Products — Oppulence",
  description: DESCRIPTION,
  alternates: { canonical: "https://oppulence.io/products" },
  openGraph: {
    title: "Products — Oppulence",
    description: DESCRIPTION,
    url: "https://oppulence.io/products",
  },
};

export default async function ProductsRoute() {
  "use cache";
  cacheLife("days");
  return <SimProductsPage />;
}
