import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { marketingMetadata } from "@/app/(marketing)/metadata";
import { createMetadata } from "@/lib/metadata";

describe("Better Auth–style app shell", () => {
  it("sets metadataBase, social cards, and icons from createMetadata", () => {
    const metadata = createMetadata({
      title: "Test page",
      description: "A test description",
    });

    expect(String(metadata.metadataBase)).toBe("https://oppulence.io/");
    expect(metadata.openGraph?.siteName).toBe("Oppulence");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.icons).toMatchObject({
      icon: [{ url: "/marketing/oppulence-icon.png", sizes: "any" }],
    });
  });

  it("keeps marketing routes on the shared metadata helper", () => {
    const metadata = marketingMetadata({
      title: "Blog",
      description: "Editorial notes.",
      path: "/blog",
    });

    expect(metadata.alternates?.canonical).toBe("https://oppulence.io/blog");
    expect(metadata.openGraph?.url).toBe("https://oppulence.io/blog");
    expect(String(metadata.metadataBase)).toBe("https://oppulence.io/");
  });

  it("loads root fonts and providers from the Better Auth layout pattern", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    const providers = readFileSync(
      new URL("../components/providers/app-providers.tsx", import.meta.url),
      "utf8",
    );

    expect(layout).toContain('from "@/lib/fonts"');
    expect(layout).toContain('from "@/lib/metadata"');
    expect(layout).toContain("AppProviders");
    expect(layout).toContain("relative min-h-dvh");
    expect(layout).toContain('data-scroll-behavior="smooth"');
    expect(providers).toContain("ThemeProvider");
    expect(providers).toContain("Toaster");
    expect(layout).toContain("react-scan@0.5.7/dist/auto.global.js");
    expect(layout).toContain("react-grab/dist/index.global.js");
    expect(layout).toContain("@react-grab/mcp/dist/client.global.js");
    expect(layout).toContain('activationKey: " "');
    expect(layout.indexOf("react-scan@0.5.7/dist/auto.global.js")).toBeLessThan(
      layout.indexOf("react-grab/dist/index.global.js"),
    );
    expect(layout).not.toContain('src="/config.js"');
    expect(layout).not.toContain("export const instant = false");
  });

  it("streams product leaves behind Suspense instead of opting each page out of instant nav", () => {
    const leaves = [
      "../app/(product)/app/page.tsx",
      "../app/(product)/app/revenue/page.tsx",
      "../app/(product)/app/agents/page.tsx",
      "../app/(product)/app/workflows/page.tsx",
      "../app/(product)/app/report/page.tsx",
      "../app/(product)/app/settings/page.tsx",
    ];

    for (const relative of leaves) {
      const page = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(page, relative).toContain("Suspense");
      expect(page, relative).toContain("PrefetchHydration");
      expect(page, relative).not.toContain("export const instant = false");
    }

    const productLayout = readFileSync(
      new URL("../app/(product)/app/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(productLayout).toContain("export const instant = false");
  });

  it("loads public fonts once instead of per route group", () => {
    const fonts = readFileSync(new URL("../lib/fonts.ts", import.meta.url), "utf8");
    const marketing = readFileSync(
      new URL("../app/(marketing)/layout.tsx", import.meta.url),
      "utf8",
    );
    const legal = readFileSync(new URL("../app/(legal)/layout.tsx", import.meta.url), "utf8");
    const auth = readFileSync(new URL("../app/(auth)/layout.tsx", import.meta.url), "utf8");

    expect(fonts).toContain('from "next/font/google"');
    expect(marketing).not.toContain('from "next/font/google"');
    expect(legal).not.toContain('from "next/font/google"');
    expect(auth).not.toContain('from "next/font/google"');
    expect(auth).toContain("marketingFontVariables");
    expect(auth).toContain("sim-landing-root");
    expect(marketing).toContain("marketingFontVariables");
  });

  it("caches public marketing and legal leaves with use cache", () => {
    const publicLeaves = [
      "../app/(marketing)/page.tsx",
      "../app/(marketing)/download/page.tsx",
      "../app/(marketing)/guides/page.tsx",
      "../app/(legal)/privacy/page.tsx",
      "../app/(legal)/terms/page.tsx",
    ];

    for (const relative of publicLeaves) {
      const page = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(page, relative).toContain('"use cache"');
      expect(page, relative).toContain("cacheLife(");
    }
  });

  it("allows react-grab CDN and localhost MCP ports in development CSP", () => {
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

    expect(config).toContain("https://unpkg.com");
    expect(config).toContain("http://localhost:5567");
  });
});
