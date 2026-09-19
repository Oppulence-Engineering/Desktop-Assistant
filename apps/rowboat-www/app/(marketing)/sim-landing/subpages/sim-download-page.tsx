import Link from "next/link";

import { Chip } from "@sim/emcn";
import { Globe, Layout, Mic } from "@sim/emcn/icons";

import { cn } from "@/lib/sim/cn";

import { DesktopDownloadChooser } from "../../desktop-download-chooser";
import { JsonLd, RelatedPages } from "../../marketing-primitives";
import { faqJsonLd } from "../../metadata";
import { SimCtaLink } from "../primitives";
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { ProductHeroPreview } from "./solutions-product/product-hero-preview";
import { SimSubpageFaqSection } from "./sim-subpage-faq";
import { SIM_SURFACE_CARD } from "./sim-surface-card";

const faqs = [
  {
    question: "Where do the files come from?",
    answer:
      "GitHub Releases for Oppulence-Engineering/Desktop-Assistant (desktop) and PlaybookMediaLLC/openwhispr (voice). The /api/download route picks the asset for the platform you asked for.",
  },
  {
    question: "What if the page guesses my computer wrong?",
    answer:
      "Open the installer list and pick the file yourself. Detection is a convenience, not a gate.",
  },
  {
    question: "Does Voice include the ledger?",
    answer:
      "No. Voice is a standalone dictation and meeting app. Desktop is the ledger next to the work. They are different downloads.",
  },
  {
    question: "Do I need a paid plan to install?",
    answer:
      "No. Installers are free. Watch, Chase, and Intelligence are account plans — see pricing for what each unlocks.",
  },
] as const;

const specs = [
  {
    term: "macOS",
    detail: "Apple silicon and Intel. DMG. Native meeting capture on macOS 14.2 and later.",
  },
  { term: "Windows", detail: "x64 installer (EXE) and portable zip from the same release." },
  { term: "Linux", detail: "arm64 and x64. DEB, RPM, and zip." },
  {
    term: "Updates",
    detail: "The app updates from GitHub Releases. You do not have to hunt for a new file.",
  },
  { term: "SBOMs", detail: "SPDX and CycloneDX attach to the release. We publish what we ship." },
  {
    term: "Signing",
    detail:
      "Desktop builds are signed for macOS and Windows. Linux packages ship with checksums on the release.",
  },
] as const;

const SURFACES = [
  {
    id: "desktop",
    eyebrow: "[desktop]",
    icon: Layout,
    title: "Oppulence Desktop",
    description:
      "The native ledger client: local vault, live notes, meeting capture, copilot, and the same relationship state as the web app when you sign in.",
    learnHref: "/desktop",
    learnLabel: "What the desktop app is",
    preview: "desktop" as const,
    chooser: {
      app: "desktop" as const,
      name: "Oppulence Desktop",
      blurb: "Sign in once and continue with the same relationship state as the web app.",
    },
  },
  {
    id: "voice",
    eyebrow: "[voice]",
    icon: Mic,
    title: "Oppulence Voice",
    description:
      "Standalone dictation and meeting notes. Transcription can run entirely on the machine. It is not the ledger.",
    learnHref: "/voice-app",
    learnLabel: "What Voice is",
    preview: "voice" as const,
    chooser: {
      app: "voice" as const,
      name: "Oppulence Voice",
      blurb: "A separate app. Use it to talk into any window, or to write a meeting down.",
    },
  },
  {
    id: "web",
    eyebrow: "[web]",
    icon: Globe,
    title: "Oppulence Web",
    description:
      "Nothing to install. Start in the browser if you want the register without a binary — same rows when you sign in.",
    learnHref: "/web",
    learnLabel: "What the web app is",
    preview: "web" as const,
    chooser: null,
  },
] as const;

/** Sim download hub — hero preview, three surfaces, specs, FAQ. */
export function SimDownloadPage() {
  return (
    <>
      <JsonLd data={faqJsonLd([...faqs])} />
      <main className="bg-[var(--bg)] pb-16 max-sm:pb-12" id="main-content">
        <section
          aria-labelledby="download-heading"
          className={cn(
            "grid grid-cols-1 gap-10 border-[var(--border)] border-b pb-12 max-sm:gap-8 max-sm:pb-10 lg:grid-cols-2 lg:items-center lg:gap-12",
            LANDING_CONTENT_WIDTH,
            LANDING_GUTTER,
          )}
          id="download"
        >
          <div className="flex flex-col gap-5">
            <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
              [download]
            </p>
            <h1
              className="max-w-[14ch] text-balance text-[48px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.025em] max-sm:text-[32px] max-xl:text-[40px]"
              id="download-heading"
            >
              Install the app that sits next to the work.
            </h1>
            <p className="max-w-[46ch] text-pretty text-[var(--text-body)] text-lg leading-[1.5] max-sm:text-base">
              Signed installers for macOS, Windows, and Linux. The page can recommend a file from
              your browser. You can still pick another.
            </p>
            <div className="flex flex-wrap gap-2">
              {["Signed builds", "Auto-update", "SBOM on release"].map((chip) => (
                <Chip key={chip} variant="outline">
                  {chip}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <SimCtaLink href="#desktop">Get Desktop</SimCtaLink>
              <SimCtaLink href="/sign-up" variant="outline">
                Use the web app
              </SimCtaLink>
            </div>
          </div>
          <div className={cn(SIM_SURFACE_CARD, "overflow-hidden")}>
            <ProductHeroPreview product="desktop" />
          </div>
        </section>

        <div className={cn("mt-12 flex flex-col gap-4", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          {SURFACES.map((surface) => (
            <article
              className={cn(SIM_SURFACE_CARD, "overflow-hidden")}
              id={surface.id}
              key={surface.id}
            >
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
                <div className="border-[var(--border)] border-b p-6 max-lg:border-b lg:border-r lg:border-b-0">
                  <div className="mb-4 flex items-center gap-2">
                    <surface.icon className="size-[14px] text-[var(--text-icon)]" />
                    <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
                      {surface.eyebrow}
                    </p>
                  </div>
                  <h2 className="text-[24px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em]">
                    {surface.title}
                  </h2>
                  <p className="mt-3 max-w-[42ch] text-[15px] text-[var(--text-secondary)] leading-[1.55]">
                    {surface.description}
                  </p>
                  <Link
                    className="mt-5 inline-flex text-[14px] text-[var(--text-body)] underline-offset-4 hover:underline"
                    href={surface.learnHref}
                  >
                    {surface.learnLabel}
                  </Link>
                </div>
                <div className="flex flex-col">
                  <div className="relative h-[280px] overflow-hidden border-[var(--border)] border-b bg-[var(--bg)] max-lg:h-[240px]">
                    <ProductHeroPreview compact product={surface.preview} />
                  </div>
                  <div className="p-6">
                    {surface.chooser ? (
                      <DesktopDownloadChooser
                        app={surface.chooser.app}
                        blurb={surface.chooser.blurb}
                        defaultOpen={surface.id === "desktop"}
                        mode="page"
                        name={surface.chooser.name}
                      />
                    ) : (
                      <div className="flex flex-col gap-4">
                        <p className="text-[14px] text-[var(--text-secondary)] leading-[1.5]">
                          No installer. Open Oppulence Web in any modern browser.
                        </p>
                        <SimCtaLink href="/sign-up" withArrow>
                          Start in the browser
                        </SimCtaLink>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        <section
          aria-labelledby="download-specs-heading"
          className={cn("mt-12", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
        >
          <div className={cn(SIM_SURFACE_CARD, "p-6 lg:p-8")}>
            <h2
              className="text-[24px] text-[var(--text-primary)] leading-[1.1] tracking-[-0.02em] lg:text-[28px]"
              id="download-specs-heading"
            >
              What we ship
            </h2>
            <p className="mt-2 max-w-[52ch] text-[15px] text-[var(--text-secondary)] leading-[1.55]">
              Installers resolve through{" "}
              <code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[13px]">
                /api/download
              </code>
              . The list below is what those files cover.
            </p>
            <dl className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {specs.map((row) => (
                <div className="flex flex-col gap-1.5" key={row.term}>
                  <dt className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.06em]">
                    {row.term}
                  </dt>
                  <dd className="text-[15px] text-[var(--text-body)] leading-[1.55]">
                    {row.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <div className={cn("mt-12", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <SimSubpageFaqSection
            faqs={[...faqs]}
            heading="Before you click download"
            lede="If the wrong binary lands, pick another. The list is the source of truth."
          />
        </div>

        <div className={cn("mt-10", LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
          <RelatedPages
            items={[
              {
                label: "Installation guide",
                href: "/guides/install-oppulence",
                description: "First-run choices after the installer.",
              },
              {
                label: "Desktop vs web",
                href: "/guides/desktop-vs-web",
                description: "Which surface for which job.",
              },
              {
                label: "Pricing",
                href: "/pricing",
                description: "What Watch, Chase, and Intelligence unlock.",
              },
              { label: "Security", href: "/security", description: "What the install can access." },
            ]}
          />
        </div>
      </main>
    </>
  );
}
