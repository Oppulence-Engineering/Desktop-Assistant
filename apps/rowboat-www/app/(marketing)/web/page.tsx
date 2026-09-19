import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";

import { SimPlatformPage } from "../sim-landing/subpages/sim-platform-page";
import { getPlatformPage } from "../marketing-data";

const page = getPlatformPage("web");

export const metadata: Metadata = {
  title: "Oppulence Web — the whole book of business in a browser tab",
  description: page?.lede,
  alternates: { canonical: "https://oppulence.io/web" },
  openGraph: {
    title: "Oppulence Web",
    description: page?.lede,
    url: "https://oppulence.io/web",
  },
};

export default async function OppulenceWebPage() {
  "use cache";
  cacheLife("days");
  if (!page) notFound();
  return <SimPlatformPage page={page} />;
}
