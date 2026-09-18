import Link from "next/link";

import { DesktopDownloadChooser } from "../desktop-download-chooser";
import { MarketingFaq } from "../marketing-faq";
import { JsonLd, MarketingBreadcrumbs, ProductFrame, RelatedPages } from "../marketing-primitives";
import { faqJsonLd, marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Download Oppulence",
  description:
    "Install Oppulence Desktop or Oppulence Voice on macOS, Windows, or Linux. Signed builds from GitHub Releases, with auto-update.",
  path: "/download",
});

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
];

export default function DownloadPage() {
  return (
    <article className="mk-capability linear-subpage">
      <JsonLd data={faqJsonLd(faqs)} />
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Download" }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[download]</p>
            <h1 className="linear-subpage-title mt-4">
              Install the app that sits next to the work.
            </h1>
          </div>
          <div className="linear-subpage-description">
            <p>
              Signed installers for macOS (Apple silicon and Intel), Windows, and Linux. The page
              can recommend a file from your browser. You can still pick another.
            </p>
          </div>
        </header>

        <ProductFrame
          alt="Oppulence Desktop home view"
          priority
          src="/marketing/desktop-home.png"
        />

        <section className="mk-download-apps">
          <article>
            <p className="linear-eyebrow">[desktop]</p>
            <h2>Oppulence Desktop</h2>
            <p>
              The native ledger client: local vault, live notes, meeting capture, copilot, and the
              same relationship state as the web app when you sign in.
            </p>
            <DesktopDownloadChooser />
            <Link className="mk-text-link" href="/desktop">
              What the desktop app is
            </Link>
          </article>
          <article>
            <p className="linear-eyebrow">[voice]</p>
            <h2>Oppulence Voice</h2>
            <p>
              Standalone dictation and meeting notes. Transcription can run entirely on the machine.
              It is not the ledger.
            </p>
            <DesktopDownloadChooser
              app="voice"
              blurb="A separate app. Use it to talk into any window, or to write a meeting down."
              name="Oppulence Voice"
            />
            <Link className="mk-text-link" href="/voice-app">
              What Voice is
            </Link>
          </article>
        </section>

        <section className="mk-specs">
          <h2>What we ship</h2>
          <dl>
            <div>
              <dt>macOS</dt>
              <dd>Apple silicon and Intel. DMG. Native meeting capture on macOS 14.2 and later.</dd>
            </div>
            <div>
              <dt>Windows</dt>
              <dd>x64 installer (EXE) and portable zip from the same release.</dd>
            </div>
            <div>
              <dt>Linux</dt>
              <dd>arm64 and x64. DEB, RPM, and zip.</dd>
            </div>
            <div>
              <dt>Updates</dt>
              <dd>The app updates from GitHub Releases. You do not have to hunt for a new file.</dd>
            </div>
            <div>
              <dt>SBOMs</dt>
              <dd>SPDX and CycloneDX attach to the release. We publish what we ship.</dd>
            </div>
            <div>
              <dt>Web</dt>
              <dd>
                Nothing to install. <Link href="/sign-up">Start in the browser</Link> if you want
                the ledger without a binary.
              </dd>
            </div>
          </dl>
        </section>

        <MarketingFaq
          heading="Before you click download"
          items={faqs}
          lede="If the wrong binary lands, pick another. The list is the source of truth."
        />
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
            { label: "Security", href: "/security", description: "What the install can access." },
          ]}
        />
      </div>
    </article>
  );
}
