import type { Metadata } from "next";

import { ProductsPage } from "../marketing-components";

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

export default function ProductsRoute() {
  return <ProductsPage />;
}
