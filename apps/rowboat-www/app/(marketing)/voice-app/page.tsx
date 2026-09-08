import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlatformProductPage } from "../marketing-components";
import { getPlatformPage } from "../marketing-data";

const page = getPlatformPage("voice-app");

export const metadata: Metadata = {
  title: "Oppulence Voice — the part of a call nobody writes down",
  description: page?.lede,
  alternates: { canonical: "https://oppulence.io/voice-app" },
  openGraph: {
    title: "Oppulence Voice",
    description: page?.lede,
    url: "https://oppulence.io/voice-app",
  },
};

export default function OppulenceVoicePage() {
  if (!page) notFound();
  return <PlatformProductPage page={page} />;
}
