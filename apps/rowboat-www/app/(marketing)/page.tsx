import type { Metadata, Viewport } from "next";

import { HomePage } from "./marketing-components";

const TITLE = "Oppulence — Stop losing deals you already won";
const DESCRIPTION =
  "That thing you promised on a call in March. The renewal that's been quiet for a month. It's all sitting in your inbox, and nobody has time to read it. Oppulence does, and tells you who needs you today.";

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
      name: "Playbook Media",
      alternateName: "Oppulence",
      url: "https://oppulence.io",
      logo: "https://oppulence.io/icon.png",
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
