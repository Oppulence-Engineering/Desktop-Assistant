import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlatformProductPage } from "../marketing-components";
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

export default function OppulenceWebPage() {
  if (!page) notFound();
  return <PlatformProductPage page={page} />;
}
