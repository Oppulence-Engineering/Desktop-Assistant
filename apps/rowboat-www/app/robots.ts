import type { MetadataRoute } from "next";

import { SITE_URL } from "./(marketing)/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app/", "/api/", "/billing/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
    // Answer engines also read /llms.txt (app/llms.txt/route.ts).
  };
}
