import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { allCapabilityPages } from "@/app/(marketing)/catalog";
import { footerGroups, headerNav, dedicatedMarketingPaths } from "@/app/(marketing)/site";
import sitemap from "@/app/sitemap";

const knownStaticHrefs = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/app",
  "/terms",
  "/privacy",
  "/responsible-disclosure",
  "/blog",
  "/customers",
  "/product",
  "/pricing",
  "/compare",
  ...dedicatedMarketingPaths.map((path) => `/${path}`),
]);

function collectHrefs() {
  return [
    ...headerNav.flatMap((group) => [
      ...(group.href ? [group.href] : []),
      ...group.items.map((item) => item.href),
    ]),
    ...footerGroups.flatMap((group) => group.items.map((item) => item.href)),
  ];
}

describe("public marketing information architecture", () => {
  it("keeps every header and footer href on a real public route", () => {
    for (const href of collectHrefs()) {
      if (href.startsWith("http") || href.startsWith("mailto:")) continue;
      expect(knownStaticHrefs.has(href), `missing public route for ${href}`).toBe(true);
    }
  });

  it("does not invent social proof or unverified first-party connectors", () => {
    const catalog = JSON.stringify(allCapabilityPages);
    expect(catalog).not.toMatch(/trusted by \d+|as featured in|SOC 2|HIPAA/i);
    expect(
      allCapabilityPages.filter((page) => page.kind === "integration").map((page) => page.slug),
    ).toEqual(["gmail", "calendar", "slack", "hubspot", "mcp"]);
  });

  it("puts the dedicated public routes in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://oppulence.io");
    expect(urls).toContain("https://oppulence.io/download");
    expect(urls).toContain("https://oppulence.io/security");
    expect(urls).toContain("https://oppulence.io/features/commitment-register");
    expect(urls).toContain("https://oppulence.io/use-cases/meetings");
    expect(urls).toContain("https://oppulence.io/compare/inbox");
    expect(urls).toContain("https://oppulence.io/blog/what-a-commitment-ledger-is");
    expect(urls).not.toContain("https://oppulence.io/customers/_template");
  });

  it("publishes robots.txt rules for the public site", () => {
    const source = readFileSync(new URL("../app/robots.ts", import.meta.url), "utf8");
    expect(source).toContain("sitemap");
    expect(source).toContain("/app/");
  });

  it("opens desktop header menus without a click-only details element", () => {
    const source = readFileSync(
      new URL("../app/(marketing)/marketing-components.tsx", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(source).toContain("sm-nav-item");
    expect(source).toContain("sm-nav-panel");
    expect(source).not.toContain("data-marketing-dropdown");
    expect(styles).toContain(".sm-nav-item:hover > .sm-nav-panel");
    expect(styles).toContain(".sm-nav-item:focus-within > .sm-nav-panel");
  });

  it("keeps the marketing 404 inside the existing public shell", () => {
    const source = readFileSync(
      new URL("../app/(marketing)/not-found.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("NotFoundMarketingPage");
    expect(source).not.toMatch(/import\s*\{[^}]*MarketingLayout/);
    expect(source).not.toMatch(/<MarketingLayout/);
  });
});
