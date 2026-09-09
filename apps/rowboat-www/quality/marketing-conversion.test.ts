import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { marketingPages, pricingPlans, productLinks } from "@/app/(marketing)/marketing-data";

const marketingComponents = readFileSync(
  new URL("../app/(marketing)/marketing-components.tsx", import.meta.url),
  "utf8",
);
const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

describe("public marketing conversion paths", () => {
  it("keeps marketing calls to action self-serve", () => {
    const links = [
      ...productLinks,
      ...marketingPages.map((page) => ({ label: page.ctaLabel, href: page.ctaHref })),
      ...pricingPlans.map((plan) => ({ label: plan.ctaLabel, href: plan.ctaHref })),
    ];

    for (const link of links) {
      expect(link.label ?? "").not.toMatch(/book (a )?(demo|revenue leak scan)|talk to/i);
      expect(link.href ?? "").not.toMatch(/^mailto:/i);
    }

    expect(marketingComponents).not.toMatch(/CONTACT_HREF|Book a demo|Talk to the team/i);
  });

  it("allows browser clients and support chat assets through the site CSP", () => {
    expect(nextConfig).toContain("https://api.workos.com");
    expect(nextConfig).toMatch(/font-src[^\n]+\$\{plainChat\.script\}/);
  });
});
