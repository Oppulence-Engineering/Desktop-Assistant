import type { Metadata, Viewport } from "next";
import { cacheLife } from "next/cache";

import { homepageFaqs } from "./catalog";
import { SimLandingPage } from "./sim-landing/landing-page";
import { JsonLd } from "./marketing-primitives";
import { faqJsonLd } from "./metadata";

const TITLE = "The commitment ledger that survives kickoff";
const DESCRIPTION =
  "Oppulence is a two-sided register of business promises. It reads Gmail, Slack, calls, and HubSpot, lists the sentences that look like commitments, and waits for you to confirm them.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://oppulence.io" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://oppulence.io",
    siteName: "Oppulence",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://oppulence.io/#organization",
      name: "Playbook Media",
      alternateName: "Oppulence",
      url: "https://oppulence.io",
      // Structured data wants a full-size logo; /icon.png is sized for a
      // browser tab, so the schema points at the full asset instead.
      logo: "https://oppulence.io/marketing/oppulence-icon.png",
    },
    {
      "@type": "SoftwareApplication",
      name: "Oppulence",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, macOS, Windows, Linux",
      description: DESCRIPTION,
      url: "https://oppulence.io",
      publisher: { "@id": "https://oppulence.io/#organization" },
    },
  ],
};

export default async function Page() {
  "use cache";
  cacheLife("days");

  return (
    <>
      <script
        // Structured data for search engines; static content, no user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <JsonLd data={faqJsonLd(homepageFaqs)} />
      <SimLandingPage />
    </>
  );
}
