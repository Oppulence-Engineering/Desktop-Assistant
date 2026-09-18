import Link from "next/link";

import { Badge } from "@oppulence/ui/components/badge";

import type { CapabilityPage } from "./catalog";
import { MarketingFaq } from "./marketing-faq";
import {
  JsonLd,
  MarketingButtonLink,
  MarketingBreadcrumbs,
  MarketingCta,
  ProductFrame,
  RelatedPages,
  SectionHeading,
} from "./marketing-primitives";
import { breadcrumbJsonLd, faqJsonLd } from "./metadata";

const kindCrumb: Record<CapabilityPage["kind"], { label: string; href: string }> = {
  feature: { label: "Features", href: "/features" },
  "use-case": { label: "Use cases", href: "/use-cases" },
  integration: { label: "Integrations", href: "/integrations" },
  guide: { label: "Guides", href: "/guides" },
};

/**
 * Long-form template for features, use cases, integrations, and guides.
 * Shared structure, unique copy per page — the opposite of a thin SEO wrapper.
 */
export function CapabilityTemplate({ page }: { page: CapabilityPage }) {
  const parent = kindCrumb[page.kind];
  const crumbs = [{ label: "Home", href: "/" }, parent, { label: page.eyebrow }];

  return (
    <article className="mk-capability linear-subpage">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: parent.label, path: parent.href },
          { name: page.eyebrow, path: page.path },
        ])}
      />
      {page.faqs.length > 0 ? <JsonLd data={faqJsonLd(page.faqs)} /> : null}

      <div className="linear-inset">
        <MarketingBreadcrumbs items={crumbs} />

        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[{page.eyebrow.toLowerCase()}]</p>
            <h1 className="linear-subpage-title mt-4">{page.title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{page.lede}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <MarketingButtonLink href="/sign-up">Start for free</MarketingButtonLink>
              <MarketingButtonLink href="/download" variant="outline">
                Download desktop
              </MarketingButtonLink>
            </div>
          </div>
        </header>

        <ProductFrame alt={page.screenshotAlt} priority src={page.screenshot} />

        <section className="mk-capability-split">
          <div>
            <SectionHeading eyebrow="[problem]" title={page.problem.title} />
            <p>{page.problem.body}</p>
          </div>
          <div>
            <SectionHeading eyebrow="[how it works]" title={page.howItWorks.title} />
            <p>{page.howItWorks.body}</p>
          </div>
        </section>

        {page.workflow.length > 0 ? (
          <section className="mk-workflow">
            <SectionHeading eyebrow="[workflow]" title="The actual sequence." />
            <ol>
              {page.workflow.map((step, index) => (
                <li key={step}>
                  <Badge className="rounded-none font-mono" variant="outline">
                    {String(index + 1).padStart(2, "0")}
                  </Badge>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {page.capabilities.length > 0 ? (
          <section className="mk-capability-grid">
            <SectionHeading eyebrow="[capabilities]" title="What this page is actually about." />
            <div>
              {page.capabilities.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {page.examples.length > 0 ? (
          <section className="mk-examples">
            <SectionHeading eyebrow="[examples]" title="Concrete, not hypothetical." />
            <div>
              {page.examples.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {page.integrations && page.integrations.length > 0 ? (
          <section className="mk-inline-links">
            <h2>Related connections</h2>
            <ul>
              {page.integrations.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {page.security ? (
          <section className="mk-security-note">
            <h2>Privacy on this surface</h2>
            <p>{page.security}</p>
            <Link href="/security">Read the full security page</Link>
          </section>
        ) : null}

        {page.faqs.length > 0 ? (
          <MarketingFaq
            items={page.faqs}
            lede="If this page raised a sharper question, it belongs here."
          />
        ) : null}

        <RelatedPages items={page.related} />
        <MarketingCta
          body="Connect the inbox, or install the desktop app and start from a local vault."
          title="See the ledger against your own history."
        />
      </div>
    </article>
  );
}
