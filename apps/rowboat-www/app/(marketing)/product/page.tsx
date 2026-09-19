import type { Metadata } from "next";
import { cacheLife } from "next/cache";

import { getMarketingPage } from "../marketing-data";
import { SimProductPage } from "../sim-landing/subpages/sim-product-page";
import { marketingMetadata } from "../metadata";

const page = getMarketingPage("product");

export const metadata: Metadata = page
  ? marketingMetadata({
      title: page.title,
      description: page.description,
      path: "/product",
    })
  : { title: "Product — Oppulence" };

export default async function ProductRoute() {
  "use cache";
  cacheLife("days");
  if (!page) return null;
  return <SimProductPage page={page} />;
}
