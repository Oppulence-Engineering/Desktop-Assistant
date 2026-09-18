import Link from "next/link";

import { MarketingFaq } from "../marketing-faq";
import { JsonLd, MarketingBreadcrumbs, MarketingCta, RelatedPages } from "../marketing-primitives";
import { faqJsonLd, marketingMetadata } from "../metadata";

export const metadata = marketingMetadata({
  title: "Security and privacy",
  description:
    "What Oppulence can access, what stays on the device, what reaches the API or a model provider, and how you turn those pipes off.",
  path: "/security",
});

const faqs = [
  {
    question: "Is Oppulence local-only?",
    answer:
      "It can be. Bring your own model keys and keep the vault on disk. Signing in syncs relationship state to the API so web and desktop match. Those are different setups.",
  },
  {
    question: "Where are OAuth tokens?",
    answer:
      "The Go API holds connector credentials. The web BFF keeps session tokens in HTTP-only encrypted cookies. The browser never gets the WorkOS access token.",
  },
  {
    question: "Do you upload crash dumps?",
    answer:
      "Native crash dumps stay on the machine. Crash metadata can go to PostHog if analytics is enabled.",
  },
];

const rows = [
  {
    title: "What the desktop can see",
    body: "A workspace folder you choose, meeting audio you start, the in-app browser pages you open, and the MCP servers you add. It does not get a silent tour of the whole disk.",
  },
  {
    title: "What stays on the machine",
    body: "Markdown vault files, capture audio, on-device Whisper transcripts, local embeddings, and ~/.rowboat/ config. Delete the folder and those copies are gone.",
  },
  {
    title: "What reaches Oppulence servers",
    body: "When you sign in: account identity via WorkOS, relationship observations you allow, and credit-gated model calls if you use the hosted gateway instead of your own keys.",
  },
  {
    title: "What reaches a model provider",
    body: "BYOK goes to the provider you configured. Signed-in hosted LLM calls go through the credit-gated /v1/llm routes. Prompts can contain relationship context you asked the assistant to use.",
  },
  {
    title: "Permissions and writes",
    body: "Connectors start as reads. Gmail, Slack, and HubSpot writes are proposed and held. Slack DMs are out of the first beta. Finance MCP write scopes are limited to development and staging.",
  },
  {
    title: "Telemetry",
    body: "PostHog analytics is fail-closed until you enable it. You can turn it off. We do not invent a SOC 2 badge or a HIPAA claim on this page.",
  },
];

export default function SecurityPage() {
  return (
    <article className="mk-capability linear-subpage">
      <JsonLd data={faqJsonLd(faqs)} />
      <div className="linear-inset">
        <MarketingBreadcrumbs items={[{ label: "Home", href: "/" }, { label: "Security" }]} />
        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[security]</p>
            <h1 className="linear-subpage-title mt-4">
              The data is yours. Connections are explicit. Sends wait.
            </h1>
          </div>
          <div className="linear-subpage-description">
            <p>
              This page is the adoption objection, written as the implementation actually behaves.
              The legal language lives on <Link href="/privacy">Privacy</Link> and{" "}
              <Link href="/responsible-disclosure">responsible disclosure</Link>.
            </p>
          </div>
        </header>

        <section className="mk-capability-grid">
          <div>
            {rows.map((row) => (
              <article key={row.title}>
                <h3>{row.title}</h3>
                <p>{row.body}</p>
              </article>
            ))}
          </div>
        </section>

        <MarketingFaq heading="The short versions" items={faqs} />
        <RelatedPages
          items={[
            {
              label: "What stays on device",
              href: "/guides/what-stays-on-device",
              description: "A walkthrough of the three pipes.",
            },
            {
              label: "Approval before send",
              href: "/guides/approval-before-send",
              description: "The write gate.",
            },
            {
              label: "Responsible disclosure",
              href: "/responsible-disclosure",
              description: "How to report a vulnerability.",
            },
          ]}
        />
        <MarketingCta
          body="Start in the browser, or install the desktop app and keep the vault on disk."
          title="Evaluate it against your own mail."
        />
      </div>
    </article>
  );
}
