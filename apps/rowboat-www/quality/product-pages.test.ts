import { describe, expect, it } from "vitest";

import { getPlatformPage, platformPages, productLinks } from "@/app/(marketing)/marketing-data";

describe("Oppulence product surfaces", () => {
  it("publishes one page per way of running Oppulence, linked from the product nav", () => {
    expect(platformPages.map((page) => page.slug)).toEqual(["web", "desktop", "voice-app"]);

    for (const page of platformPages) {
      expect(productLinks).toContainEqual(expect.objectContaining({ href: `/${page.slug}` }));
    }
  });

  it("offers an installer on the two surfaces that ship one", () => {
    // Web runs in the browser, so a download link there would be a dead end.
    expect(getPlatformPage("web")?.download).toBe(false);
    expect(getPlatformPage("desktop")?.download).toBe(true);
    expect(getPlatformPage("voice-app")?.download).toBe(true);
  });

  it("gives every product page the copy the layout depends on", () => {
    for (const page of platformPages) {
      expect(page.name).toMatch(/^Oppulence /);
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.lede.length).toBeGreaterThan(0);
      expect(page.summary.length).toBeGreaterThan(0);
      expect(page.sections.length).toBeGreaterThanOrEqual(3);
      expect(page.specs.length).toBeGreaterThanOrEqual(3);

      for (const section of page.sections) {
        expect(section.bullets.length).toBeGreaterThan(0);
        expect(section.screenshot).toMatch(/^\/marketing\//);
        expect(section.alt.length).toBeGreaterThan(0);
      }
    }
  });
});
