import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { MetadataRoute } from "next";

import { comparePages } from "./(marketing)/compare-catalog";
import { marketingPaths } from "./(marketing)/marketing-data";
import { SITE_URL, dedicatedMarketingPaths } from "./(marketing)/site";

function publishedContentPaths(kind: "blog" | "customers") {
  const root = join(process.cwd(), "content", kind);
  return readdirSync(root)
    .filter((file) => file.endsWith(".mdx") && !file.startsWith("_"))
    .flatMap((file) => {
      const source = readFileSync(join(root, file), "utf8");
      if (kind === "customers" && !/^published:\s*true\s*$/m.test(source)) return [];
      if (kind === "blog" && /^draft:\s*true\s*$/m.test(source)) return [];
      return [`${kind}/${file.replace(/\.mdx$/, "")}`];
    });
}

export default function sitemap(): MetadataRoute.Sitemap {
  const seen = new Set<string>([SITE_URL]);

  const add = (
    path: string,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
    priority: number,
  ) => {
    const url = path === "" ? SITE_URL : `${SITE_URL}/${path}`;
    if (seen.has(url)) return null;
    seen.add(url);
    return { url, changeFrequency, priority };
  };

  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...dedicatedMarketingPaths
      .map((route) =>
        add(route, route === "download" || route === "blog" ? "weekly" : "monthly", 0.8),
      )
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    ...publishedContentPaths("blog")
      .map((route) => add(route, "monthly", 0.6))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    ...["product", "workflow", "security", "install"]
      .map((category) => add(`blog/category/${category}`, "weekly", 0.5))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    ...publishedContentPaths("customers")
      .map((route) => add(route, "monthly", 0.5))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    ...comparePages
      .map((page) => add(page.path.slice(1), "monthly", 0.7))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    ...marketingPaths
      .map((route) => add(route, "monthly", route === "product" || route === "pricing" ? 0.9 : 0.6))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    ...["terms", "privacy", "responsible-disclosure"]
      .map((route) => add(route, "yearly", 0.3))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  ];
}
