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
  ];
}
