import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { allCapabilityPages } from "@/app/(marketing)/catalog";
import { getMarketingPage } from "@/app/(marketing)/marketing-data";
import { buildLlmsTxt, getSeoLander } from "@/app/(marketing)/seo-theme";
import { footerGroups, headerNav, dedicatedMarketingPaths } from "@/app/(marketing)/site";
import { buildPublicSitemap } from "@/app/sitemap";

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
    const urls = buildPublicSitemap().map((entry) => entry.url);
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
    expect(source).toContain("llms.txt");
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

  it("keeps the public header on product pages instead of the leftover homepage rail", () => {
    const source = readFileSync(
      new URL("../app/(marketing)/marketing-components.tsx", import.meta.url),
      "utf8",
    );
    const hero = readFileSync(
      new URL("../app/(marketing)/sim-landing/hero.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("sm-suite-public");
    expect(source).not.toContain("sm-memory-home sm-suite-shell");
    expect(source).not.toContain("export function HomePage");
    expect(hero).toContain('href="/use-cases/account-management"');
    expect(source).not.toContain("/use-cases/sales-to-delivery-handoff");
    expect(source).not.toContain("/features/handoff-report");
    expect(source).not.toContain("/features/watch-after-kickoff");
    expect(source).toContain('className="mk-capability linear-subpage"');
  });

  it("styles catalog and compare pages instead of shipping class names with no CSS", () => {
    const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const simLandingStyles = readFileSync(
      new URL("../app/(marketing)/sim-landing/sim-landing.css", import.meta.url),
      "utf8",
    );
    const shell = readFileSync(
      new URL("../app/(marketing)/sim-landing/landing-shell.tsx", import.meta.url),
      "utf8",
    );
    const layoutClient = readFileSync(
      new URL("../app/(marketing)/marketing-layout-client.tsx", import.meta.url),
      "utf8",
    );
    const siteBlock = styles.slice(styles.indexOf("  .sm-site {"));
    expect(siteBlock).toContain("--sm-ink");
    expect(siteBlock).toContain("--mem-ink: var(--sm-ink)");
    expect(styles).toContain(".mk-index-card");
    expect(styles).toContain(".mk-compare-table");
    expect(styles).toContain(".mk-capability-grid");
    expect(styles).toContain("marketing-sim-theme.css");
    expect(simLandingStyles).toContain(".sim-landing-root");
    expect(simLandingStyles).toContain(".sim-landing-header");
    expect(simLandingStyles).toContain(".sim-landing-scroll-port");
    expect(shell).toContain("SimFooter");
    expect(shell).toContain("SimTopBar");
    expect(layoutClient).toContain("SimLandingShell");
    expect(styles).toContain(".sm-site .marketing-surface");
  });

  it("states what Oppulence is on the homepage hero", () => {
    const landing = readFileSync(
      new URL("../app/(marketing)/sim-landing/landing-page.tsx", import.meta.url),
      "utf8",
    );
    const hero = readFileSync(
      new URL("../app/(marketing)/sim-landing/hero.tsx", import.meta.url),
      "utf8",
    );
    const productDemo = readFileSync(
      new URL("../app/(marketing)/sim-landing/product-demo.tsx", import.meta.url),
      "utf8",
    );
    const editorial = readFileSync(
      new URL("../app/(marketing)/sim-landing/editorial.tsx", import.meta.url),
      "utf8",
    );
    const footerWordmark = readFileSync(
      new URL("../app/(marketing)/sim-landing/footer-wordmark.tsx", import.meta.url),
      "utf8",
    );
    const footer = readFileSync(
      new URL("../app/(marketing)/sim-landing/sim-footer.tsx", import.meta.url),
      "utf8",
    );
    const simLandingStyles = readFileSync(
      new URL("../app/(marketing)/sim-landing/sim-landing.css", import.meta.url),
      "utf8",
    );
    const closingCta = readFileSync(
      new URL("../app/(marketing)/sim-landing/closing-cta.tsx", import.meta.url),
      "utf8",
    );
    const footerArtwork = readFileSync(
      new URL("../app/(marketing)/sim-landing/footer-artwork.ts", import.meta.url),
      "utf8",
    );
    const footerArtworkPlate = readFileSync(
      new URL("../app/(marketing)/sim-landing/footer-artwork-plate.tsx", import.meta.url),
      "utf8",
    );
    const landingShell = readFileSync(
      new URL("../app/(marketing)/sim-landing/landing-shell.tsx", import.meta.url),
      "utf8",
    );
    const layoutClient = readFileSync(
      new URL("../app/(marketing)/marketing-layout-client.tsx", import.meta.url),
      "utf8",
    );
    const layout = readFileSync(
      new URL("../app/(marketing)/sim-landing/tokens.ts", import.meta.url),
      "utf8",
    );
    const page = readFileSync(new URL("../app/(marketing)/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("SimLandingPage");
    expect(hero).toContain("SimHeroPlatformStage");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/hero-platform-stage.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("HeroPlatformLoopMount");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/hero-platform-stage.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("SimMobileHeroPreview");
    expect(productDemo).toContain("ProductDemoCaption");
    expect(hero).toContain("A two-sided register of business promises");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/platform-suite.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("IsoIntegrateIllustration");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/platform-suite.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("ResponsiveDesignStage");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/hero-platform-loop.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("HeroLoopShell");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/hero-platform-stage.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("sim-product-preview");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/platform-suite.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain('data-iso-hover=""');
    expect(landing).toContain("SimFeaturesRail");
    expect(productDemo).toContain("ProductDemoBeatProvider");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/product-demo-visual.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("ProductDemoVisualMount");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/composer-loop.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("composer-goo");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/mobile-hero-preview.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("EdgeFade");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/workspace-controls.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("size-[56px]");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/composer-loop.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain("ComposerWorkflowStage");
    expect(landing).not.toMatch(/<main[\s>]/);
    expect(editorial).toContain("Oppulence is not a CRM, and it is not your inbox.");
    expect(editorial).toContain("Commitment ledger");
    expect(editorial).toContain("SimAgentMomentum");
    expect(footer).toContain("SimThemeToggle");
    expect(footerWordmark).toContain("FooterWordmarkLoop");
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/footer-wordmark-loop.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain('data-stage="squeeze"');
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/footer-wordmark-loop.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain('data-anim="metaballsA"');
    expect(
      readFileSync(
        new URL("../app/(marketing)/sim-landing/footer-wordmark-loop.tsx", import.meta.url),
        "utf8",
      ),
    ).toContain('"metaballs", 2000');
    expect(simLandingStyles).toContain(".dark .sim-landing-root");
    expect(simLandingStyles).toContain("--text-base: 15px");
    expect(simLandingStyles).toContain(".sim-product-preview");
    expect(simLandingStyles).toContain(".design-surface");
    expect(simLandingStyles).toContain("--preview-scale");
    expect(simLandingStyles).toContain("--preview-sidebar-width: 238px");
    expect(simLandingStyles).toContain(".text-\\[15px\\]");
    expect(
      readFileSync(
        new URL(
          "../app/(marketing)/sim-landing/shared/responsive-design-stage.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toContain("design-surface");
    expect(
      readFileSync(
        new URL(
          "../app/(marketing)/sim-landing/shared/responsive-design-stage.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toContain("--preview-scale");
    expect(simLandingStyles).toContain("--surface-3: #242424");
    expect(simLandingStyles).not.toContain("letter-spacing: 0.28px");
    expect(simLandingStyles).not.toMatch(/font-family:/);
    expect(layout).toContain("HOME_TYPE");
    expect(landing).toContain("SimAgentMomentum");
    expect(landing).toContain("SimProblemEditorial");
    expect(landing).toContain("gap-16 max-sm:gap-10 max-lg:gap-12");
    expect(landing).toContain("gap-7 max-lg:gap-4");
    expect(landing).toContain("SimFaqSection");
    expect(closingCta).toContain("FooterArtworkPlate");
    expect(closingCta).toContain("sim-closing-artwork__plate");
    expect(closingCta).not.toContain("brightness-[0.28]");
    expect(footerArtworkPlate).toContain("FOOTER_ARTWORK");
    expect(footerArtworkPlate).toContain("block dark:hidden");
    expect(footerArtworkPlate).toContain('type="image/avif"');
    expect(footerArtworkPlate).toContain('type="image/webp"');
    expect(footerArtworkPlate).toContain("avifSrcSet");
    expect(footerArtwork).toContain("/marketing/footer-artwork/");
    expect(footerArtwork).toContain("nyc-skyline");
    expect(footerArtwork).toContain("B&W");
    expect(footerArtwork).not.toContain("observe.webp");
    expect(simLandingStyles).toContain(".sim-closing-artwork__plate");
    expect(simLandingStyles).toContain(".sm-site.sim-marketing-site");
    expect(landingShell).toContain("linear-shell linear-guides");
    expect(layoutClient).toContain("sim-marketing-site");
    expect(layoutClient).toContain("sim-home-site");
    expect(layoutClient).toContain('variant={isHome ? "home" : "subpage"}');
    expect(landingShell).toMatch(/<SimClosingCta\s*\/>[\s\S]*<SimFooter\s*\/>/);
    expect(layout).toContain("HOME_INSET");
  });

  it("applies Ferndesk lander titles, FAQ schema, and an answer hub", () => {
    const page = getMarketingPage("help-center-software");
    const lander = getSeoLander("help-center-software");
    const source = readFileSync(
      new URL("../app/(marketing)/seo-lander.tsx", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

    expect(page?.title).toMatch(/Help center software/i);
    expect(lander?.faqs.length).toBeGreaterThan(0);
    expect(source).toContain("faqJsonLd");
    expect(source).toContain("definedTermJsonLd");
    expect(styles).toContain(".mk-seo-chips");
    expect(styles).toContain(".mk-seo-audience");
    expect(buildLlmsTxt()).toContain("https://oppulence.io/help-center-software");
    expect(buildLlmsTxt()).toContain("https://oppulence.io/answers");
    expect(buildPublicSitemap().map((entry) => entry.url)).toContain(
      "https://oppulence.io/answers",
    );
  });

  it("applies Sim chrome to every marketing route, not only the homepage", () => {
    const layoutClient = readFileSync(
      new URL("../app/(marketing)/marketing-layout-client.tsx", import.meta.url),
      "utf8",
    );
    const shell = readFileSync(
      new URL("../app/(marketing)/sim-landing/landing-shell.tsx", import.meta.url),
      "utf8",
    );
    const theme = readFileSync(
      new URL("../app/(marketing)/marketing-sim-theme.css", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

    expect(layoutClient).toContain("SimLandingShell");
    expect(layoutClient).not.toContain("TopBar");
    expect(layoutClient).not.toContain("<Footer");
    expect(layoutClient).toContain("app-vh-shell");
    expect(layoutClient).toContain("sim-marketing-site");
    expect(shell).toContain("sim-marketing-page-main");
    expect(shell).toContain('variant = "subpage"');
    expect(shell).toContain("linear-shell linear-guides");
    expect(theme).toContain(".sim-marketing-page-main");
    expect(theme).toContain('@import "./sim-landing/sim-landing.css"');
    expect(styles).toContain("marketing-sim-theme.css");

    const marketingPages = [
      "../app/(marketing)/pricing/page.tsx",
      "../app/(marketing)/products/page.tsx",
      "../app/(marketing)/security/page.tsx",
      "../app/(marketing)/download/page.tsx",
      "../app/(marketing)/contact/page.tsx",
      "../app/(marketing)/compare/page.tsx",
      "../app/(marketing)/features/page.tsx",
      "../app/(marketing)/blog/page.tsx",
    ];

    for (const pagePath of marketingPages) {
      const source = readFileSync(new URL(pagePath, import.meta.url), "utf8");
      expect(source).not.toContain("MarketingLayout");
      expect(source).not.toContain("SimLandingShell");
    }
  });

  it("ports priority marketing routes to Sim subpage bodies", () => {
    const refactored = [
      {
        route: "../app/(marketing)/pricing/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-pricing-page.tsx",
        markers: ["SimPricingPage", "SimPricingCard"],
        extra: "../app/(marketing)/sim-landing/subpages/sim-pricing-card.tsx",
        extraMarkers: ["var(--surface-2)"],
      },
      {
        route: "../app/(marketing)/security/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-security-page.tsx",
        markers: ["SimSecurityPage", "SOC 2 badge", "SimSubpageFaqSection"],
      },
      {
        route: "../app/(marketing)/contact/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-contact-page.tsx",
        markers: ["SimContactPage", "Plain widget", "TrustedBy"],
      },
      {
        route: "../app/(marketing)/compare/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-compare-hub.tsx",
        markers: ["SimCompareHub", "Category seams", "how to read these"],
      },
      {
        route: "../app/(marketing)/features/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-catalog-hub.tsx",
        markers: ["SimCatalogHub", "All features"],
      },
      {
        route: "../app/(marketing)/compare-page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-compare-detail.tsx",
        markers: [
          "SimCompareDetailPage",
          "All category seams",
          "[the seam in one line]",
          "The usual tool",
        ],
      },
      {
        route: "../app/(marketing)/download/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-download-page.tsx",
        markers: ["SimDownloadPage", "DesktopDownloadChooser"],
        extra: "../app/(marketing)/sim-landing/subpages/sim-surface-card.tsx",
        extraMarkers: ["var(--surface-2)"],
      },
      {
        route: "../app/(marketing)/products/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-products-page.tsx",
        markers: ["SimProductsPage", "SimSolutionsProductPage", "productsSuiteToSolutionsConfig"],
        extra: "../app/(marketing)/sim-landing/subpages/solutions-product/platform-explorer.tsx",
        extraMarkers: ["PlatformExplorer"],
      },
      {
        route: "../app/(marketing)/web/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-platform-page.tsx",
        markers: ["SimPlatformPage", "SimSolutionsProductPage", "platformToSolutionsConfig"],
      },
      {
        route: "../app/(marketing)/desktop/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-platform-page.tsx",
        markers: ["SimPlatformPage", "SimSolutionsProductPage"],
      },
      {
        route: "../app/(marketing)/voice-app/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-platform-page.tsx",
        markers: ["SimPlatformPage", "SimSolutionsProductPage"],
      },
      {
        route: "../app/(marketing)/blog/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-blog-index-page.tsx",
        markers: ["SimBlogIndexPage", "SimBlogList"],
      },
      {
        route: "../app/(marketing)/blog/category/[category]/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-blog-index-page.tsx",
        markers: ["SimBlogIndexPage"],
      },
      {
        route: "../app/(marketing)/article-page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-editorial-article.tsx",
        markers: ["SimEditorialArticle", "SimBorderedColumn"],
      },
      {
        route: "../app/(marketing)/use-cases/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-catalog-hub.tsx",
        markers: ["SimCatalogHub", "All use cases"],
      },
      {
        route: "../app/(marketing)/integrations/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-catalog-hub.tsx",
        markers: ["SimCatalogHub", "First-party connectors"],
      },
      {
        route: "../app/(marketing)/capability-page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-capability-page.tsx",
        markers: ["SimCapabilityPage", "SimSolutionsProductPage", "capabilityToSolutionsConfig"],
      },
      {
        route: "../app/(marketing)/product/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-product-page.tsx",
        markers: ["SimProductPage", "SimSolutionsProductPage", "productToSolutionsConfig"],
      },
      {
        route: "../app/(marketing)/guides/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-catalog-hub.tsx",
        markers: ["SimCatalogHub", "All guides"],
      },
      {
        route: "../app/(marketing)/resources/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-resources-page.tsx",
        markers: ["SimResourcesPage", "docs.oppulence.io"],
      },
      {
        route: "../app/(marketing)/customers/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-customers-index-page.tsx",
        markers: ["SimCustomersIndexPage", "Not invented ones"],
      },
      {
        route: "../app/(marketing)/changelog/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-changelog-page.tsx",
        markers: ["SimChangelogPage", "GitHub Releases"],
      },
      {
        route: "../app/(marketing)/answers/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-answers-page.tsx",
        markers: ["SimAnswersPage", "Definition pages"],
      },
      {
        route: "../app/(marketing)/billing/cancel/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-billing-status-page.tsx",
        markers: ["SimBillingStatusPage", "Checkout cancelled"],
      },
      {
        route: "../app/(marketing)/billing/success/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-billing-status-page.tsx",
        markers: ["SimBillingStatusPage", "Your subscription is active"],
      },
      {
        route: "../app/(marketing)/[...slug]/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-seo-lander-page.tsx",
        markers: ["SimSeoLanderPage", "SimFeatureMirrorPage", "SimMarketingBulletPage"],
      },
      {
        route: "../app/(marketing)/blog/[slug]/page.tsx",
        body: "../app/(marketing)/sim-landing/subpages/sim-seo-alternative-page.tsx",
        markers: ["SimSeoAlternativePage", "SimBlogArchivePage"],
      },
    ];

    for (const entry of refactored) {
      const route = readFileSync(new URL(entry.route, import.meta.url), "utf8");
      const body = readFileSync(new URL(entry.body, import.meta.url), "utf8");
      const extra = entry.extra ? readFileSync(new URL(entry.extra, import.meta.url), "utf8") : "";
      for (const marker of entry.markers) {
        if (marker === "TrustedBy") {
          expect(body).not.toContain(marker);
          continue;
        }
        if (marker === "SOC 2 badge") {
          expect(body).toContain(marker);
          continue;
        }
        expect(
          route.includes(marker) || body.includes(marker),
          `${entry.route} missing ${marker}`,
        ).toBe(true);
      }
      for (const marker of entry.extraMarkers ?? []) {
        expect(extra.includes(marker), `${entry.extra ?? entry.route} missing ${marker}`).toBe(
          true,
        );
      }
      expect(route).not.toContain("MarketingCta");
      expect(route).not.toContain("linear-subpage");
      expect(route).not.toContain("mk-index-card");
    }
  });

  it("completes Sim body migration for all marketing route patterns", () => {
    const phaseFourRoutes = [
      "../app/(marketing)/product/page.tsx",
      "../app/(marketing)/guides/page.tsx",
      "../app/(marketing)/resources/page.tsx",
      "../app/(marketing)/customers/page.tsx",
      "../app/(marketing)/changelog/page.tsx",
      "../app/(marketing)/answers/page.tsx",
      "../app/(marketing)/billing/cancel/page.tsx",
      "../app/(marketing)/billing/success/page.tsx",
      "../app/(marketing)/[...slug]/page.tsx",
      "../app/(marketing)/blog/[slug]/page.tsx",
    ];

    for (const routePath of phaseFourRoutes) {
      const source = readFileSync(new URL(routePath, import.meta.url), "utf8");
      expect(source).not.toContain("MarketingCta");
      expect(source).not.toContain("linear-subpage");
      expect(source).not.toContain("CatalogIndex");
      expect(source).not.toContain("BlogArticlePage");
    }
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
