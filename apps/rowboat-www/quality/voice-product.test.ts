import { describe, expect, it } from "vitest";

import { getMarketingPage, marketingPaths, productLinks } from "@/app/(marketing)/marketing-data";

describe("Oppulence Voice product surface", () => {
  it("publishes one discoverable product page linked to the dedicated docs", () => {
    const page = getMarketingPage("voice");

    expect(marketingPaths.filter((path) => path === "voice")).toHaveLength(1);
    expect(productLinks).toContainEqual(expect.objectContaining({ href: "/voice" }));
    expect(page).toMatchObject({
      category: "product",
      ctaHref: "https://docs.oppulence.io",
      eyebrow: "Oppulence Voice",
    });
  });
});
