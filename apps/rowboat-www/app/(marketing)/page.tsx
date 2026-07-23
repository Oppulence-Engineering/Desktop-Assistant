import type { Metadata, Viewport } from "next";

import { HomePage } from "./marketing-components";

const TITLE = "Oppulence — Turn silence back into revenue";
const DESCRIPTION =
  "Oppulence watches your inbox, calendar, and billing. It finds the deals, invoices, and clients that go quiet. It writes the chase in your voice. You approve every send.";

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
    { media: "(prefers-color-scheme: light)", color: "#fcfcfc" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://oppulence.io/#organization",
      name: "Oppulence",
      url: "https://oppulence.io",
      logo: "https://oppulence.io/icon.png",
    },
    {
      "@type": "SoftwareApplication",
      name: "Oppulence",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: DESCRIPTION,
      url: "https://oppulence.io",
      offers: [
        { "@type": "Offer", name: "Watch", price: "0", priceCurrency: "USD" },
        { "@type": "Offer", name: "Chase", price: "99", priceCurrency: "USD" },
      ],
      publisher: { "@id": "https://oppulence.io/#organization" },
    },
  ],
};

export default function Page() {
  return (
    <>
      <script
        // Structured data for search engines; static content, no user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        type="application/ld+json"
      />
      <HomePage />
    </>
  );
}
