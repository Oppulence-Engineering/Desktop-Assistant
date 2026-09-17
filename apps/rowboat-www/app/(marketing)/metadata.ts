import type { Metadata } from "next";

import { createMetadata } from "@/lib/metadata";

import { SITE_NAME, SITE_URL, absoluteUrl } from "./site";

type MarketingMetaInput = {
  title: string;
  description: string;
  path: string;
  index?: boolean;
};

/**
 * Shared public-page metadata. Titles stay unique; canonical, Open Graph, and
 * Twitter cards are always present so a new route cannot ship without them.
 */
export function marketingMetadata({
  title,
  description,
  path,
  index = true,
}: MarketingMetaInput): Metadata {
  const url = absoluteUrl(path);
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;

  return createMetadata({
    title: fullTitle,
    description,
    alternates: { canonical: url },
    robots: index ? undefined : { index: false, follow: false },
    openGraph: {
      title: fullTitle,
      description,
      url,
      images: [
        {
          url: `${SITE_URL}/marketing/oppulence-icon.png`,
          alt: `${SITE_NAME} mark`,
        },
      ],
    },
    twitter: {
      title: fullTitle,
      description,
    },
  });
}

export function faqJsonLd(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function articleJsonLd({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    url: absoluteUrl(path),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}
