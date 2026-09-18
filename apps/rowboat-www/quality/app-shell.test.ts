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
  });

  it("allows react-grab CDN and localhost MCP ports in development CSP", () => {
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

    expect(config).toContain("https://unpkg.com");
    expect(config).toContain("http://localhost:5567");
  });
});
