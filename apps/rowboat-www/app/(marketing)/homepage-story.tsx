import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@oppulence/ui/components/badge";

import { featurePages, homepageFaqs, useCasePages } from "./catalog";
import { MarketingButtonLink, MarketingSpan } from "./marketing-primitives";
import { MarketingFaq } from "./marketing-faq";

const problemRows = [
  {
    title: "Orphaned promise",
    body: "A delivery date lives in one person's sent folder and nowhere else.",
  },
  {
    title: "Late discovery",
    body: "Delivery learns about the commitment after the date has passed.",
  },
  {
    title: "Undefended dispute",
    body: "An argument about what was agreed is conducted from memory.",
  },
  {
    title: "Key-person risk",
    body: "The person who made the promises leaves, and the obligations leave with them.",
  },
] as const;

/** Inline heading fragment; renders a span for Attio h2 color selectors. */
function HeadingFragment({ children }: { children: ReactNode }) {
  return <MarketingSpan>{children}</MarketingSpan>;
}

const verifiedSources = [
  { label: "Gmail", href: "/integrations/gmail" },
  { label: "Google Calendar", href: "/integrations/calendar" },
  { label: "Slack", href: "/integrations/slack" },
  { label: "HubSpot", href: "/integrations/hubspot" },
  { label: "MCP", href: "/integrations/mcp" },
] as const;

/**
 * Homepage sections that sit on top of the existing Attio-style story.
 * Kept in this file so the original HomePage can grow without becoming
 * another two-thousand-line component.
 */
export function HomepageProblem() {
  return (
    <section className="sm-attio-problem" id="problem">
      <div className="sm-attio-shell">
        <p className="sm-attio-section-label">The job</p>
        <h2>
          <HeadingFragment>Every company has a system of record for what it sold.</HeadingFragment>
          <HeadingFragment> Almost none have one for what they owe.</HeadingFragment>
        </h2>
        <p className="sm-attio-problem-lede">
          Promises are made in email, on calls, and in Slack. They are kept by someone else. They
          are only noticed when they break. Oppulence is the independent record of those
          obligations, with the evidence still attached.
        </p>
        <div className="sm-attio-problem-grid">
          {problemRows.map((row) => (
            <article key={row.title}>
              <h3>{row.title}</h3>
              <p>{row.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomepageCapabilities() {
  return (
    <section className="sm-attio-capabilities" id="capabilities">
      <div className="sm-attio-shell">
        <div className="sm-attio-section-head">
          <p className="sm-attio-section-label">Capabilities</p>
          <h2>
            <HeadingFragment>Enough room to understand the product.</HeadingFragment>
            <HeadingFragment> Not a row of icon cards.</HeadingFragment>
          </h2>
          <Link className="sm-attio-head-link" href="/features">
            All features
          </Link>
        </div>
        <div className="sm-attio-capability-list">
          {featurePages.slice(0, 4).map((feature) => (
            <article key={feature.slug}>
              <div>
                <p>{feature.eyebrow}</p>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <Link href={feature.path}>Open {feature.eyebrow.toLowerCase()}</Link>
              </div>
              <figure>
                <Image
                  alt={feature.screenshotAlt}
                  height={720}
                  sizes="(max-width: 900px) 100vw, 480px"
                  src={feature.screenshot}
                  width={960}
                />
              </figure>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomepageUseCases() {
  return (
    <section className="sm-attio-usecases" id="use-cases">
      <div className="sm-attio-shell">
        <div className="sm-attio-section-head">
          <p className="sm-attio-section-label">Use cases</p>
          <h2>
            <HeadingFragment>What changes on Monday.</HeadingFragment>
          </h2>
          <Link className="sm-attio-head-link" href="/use-cases">
            All use cases
          </Link>
        </div>
        <div className="sm-attio-usecase-grid">
          {useCasePages.map((page) => (
            <Link href={page.path} key={page.slug}>
              <Badge className="rounded-none" variant="outline">
                {page.eyebrow}
              </Badge>
              <strong>{page.title}</strong>
              <p>{page.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomepageTrust() {
  return (
    <section className="sm-attio-trust" id="trust">
      <div className="sm-attio-shell">
        <div className="sm-attio-section-head">
          <p className="sm-attio-section-label">Trust</p>
          <h2>
            <HeadingFragment>Local when it should be local.</HeadingFragment>
            <HeadingFragment> Cloud when you sign in.</HeadingFragment>
          </h2>
          <Link className="sm-attio-head-link" href="/security">
            Security and privacy
          </Link>
        </div>
        <div className="sm-attio-trust-grid">
          <article>
            <h3>On the machine</h3>
            <p>
              Markdown vault, meeting audio, on-device transcription, local embeddings, and
              bring-your-own model keys can stay on the desktop.
            </p>
          </article>
          <article>
            <h3>In the workspace</h3>
            <p>
              Signed-in relationship state syncs so web and desktop share the same ledger. Tokens
              stay in the API broker or HTTP-only cookies, not in localStorage.
            </p>
          </article>
          <article>
            <h3>Before anything is sent</h3>
            <p>
              Gmail, Slack, and HubSpot writes are drafted and held. A person approves. That is the
              product, not a setting buried in an enterprise SKU.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

export function HomepageIntegrations() {
  return (
    <section className="sm-attio-sources" id="integrations">
      <div className="sm-attio-shell">
        <p className="sm-attio-section-label">Integrations</p>
        <h2>The sources that actually exist.</h2>
        <p>
          First-party relationship connectors today: Gmail, Google Calendar, Slack, and HubSpot.
          Desktop also speaks MCP. We will not put Salesforce on this row to look busier.
        </p>
        <div className="sm-attio-source-row">
          {verifiedSources.map((source) => (
            <Link href={source.href} key={source.href}>
              {source.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomepageFaq() {
  return (
    <div className="sm-attio-faq">
      <div className="sm-attio-shell">
        <MarketingFaq
          heading="Before you install it"
          items={homepageFaqs}
          lede="These are the questions that stop a careful team. The answers are the product constraints, not slogans."
        />
      </div>
    </div>
  );
}

export function HomepageDownload() {
  return (
    <section className="sm-attio-download">
      <div className="sm-attio-shell">
        <p className="sm-attio-section-label">Desktop</p>
        <h2>Install it next to the work.</h2>
        <p>
          Signed builds for macOS, Windows, and Linux. Apple silicon and Intel. The same ledger as
          the browser, plus a local vault and meeting capture.
        </p>
        <div className="sm-attio-actions flex flex-wrap gap-3">
          <MarketingButtonLink href="/download">Download Oppulence</MarketingButtonLink>
          <MarketingButtonLink href="/guides/install-oppulence" variant="outline">
            Installation guide
          </MarketingButtonLink>
        </div>
      </div>
    </section>
  );
}
