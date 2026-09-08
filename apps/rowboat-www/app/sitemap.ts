import type { MetadataRoute } from "next";

import { marketingPaths } from "./(marketing)/marketing-data";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://oppulence.io", changeFrequency: "weekly", priority: 1 },
    ...marketingPaths.map((route) => ({
      url: `https://oppulence.io/${route}`,
      changeFrequency: "monthly" as const,
      priority: route === "voice" || route === "product" ? 0.9 : 0.7,
    })),
    // Legal pages are stable but should still be discoverable, particularly
    // responsible-disclosure, which researchers look for by search.
    ...["terms", "privacy", "responsible-disclosure"].map((route) => ({
      url: `https://oppulence.io/${route}`,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
