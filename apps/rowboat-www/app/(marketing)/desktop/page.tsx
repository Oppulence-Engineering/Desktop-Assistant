import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";

import { SimPlatformPage } from "../sim-landing/subpages/sim-platform-page";
import { getPlatformPage } from "../marketing-data";

const page = getPlatformPage("desktop");

export const metadata: Metadata = {
  title: "Oppulence Desktop — Oppulence next to the work",
  description: page?.lede,
  alternates: { canonical: "https://oppulence.io/desktop" },
  openGraph: {
    title: "Oppulence Desktop",
    description: page?.lede,
    url: "https://oppulence.io/desktop",
  },
};

export default async function OppulenceDesktopPage() {
  "use cache";
  cacheLife("days");
  if (!page) notFound();
  return <SimPlatformPage page={page} />;
}
