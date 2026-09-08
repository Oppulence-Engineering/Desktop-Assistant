import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlatformProductPage } from "../marketing-components";
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

export default function OppulenceDesktopPage() {
  if (!page) notFound();
  return <PlatformProductPage page={page} />;
}
