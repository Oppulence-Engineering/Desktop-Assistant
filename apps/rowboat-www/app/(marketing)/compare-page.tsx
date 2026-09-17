import { MarketingSpan, marketingSpanClass } from "./marketing-primitives";

import type { ComparePage } from "./compare-catalog";
import { MarketingFaq } from "./marketing-faq";
import {
  JsonLd,
  MarketingBreadcrumbs,
  MarketingCta,
  RelatedPages,
  SectionHeading,
} from "./marketing-primitives";
import { breadcrumbJsonLd, faqJsonLd } from "./metadata";

export function CompareTemplate({ page }: { page: ComparePage }) {
  return (
    <article className="mk-capability linear-subpage">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: page.eyebrow, path: page.path },
        ])}
      />
      {page.faqs.length > 0 ? <JsonLd data={faqJsonLd(page.faqs)} /> : null}

      <div className="linear-inset">
        <MarketingBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Compare", href: "/compare" },
            { label: page.eyebrow },
          ]}
        />

        <header className="linear-subpage-hero">
          <div>
            <p className="linear-eyebrow">[compare]</p>
            <h1 className="linear-subpage-title mt-4">{page.title}</h1>
          </div>
          <div className="linear-subpage-description">
            <p>{page.lede}</p>
          </div>
        </header>

        <section className="mk-capability-split">
          <div>
            <SectionHeading eyebrow="[them]" title={page.them.title} />
            <p>{page.them.body}</p>
          </div>
          <div>
            <SectionHeading eyebrow="[oppulence]" title={page.us.title} />
            <p>{page.us.body}</p>
          </div>
        </section>

        <section className="mk-compare-table-wrap">
          <SectionHeading eyebrow="[difference]" title="Where the jobs actually split." />
          <div
            className="mk-compare-table"
            role="table"
            aria-label={`${page.eyebrow} compared with Oppulence`}
          >
            <div className="mk-compare-row mk-compare-row-head" role="row">
              <MarketingSpan className="font-normal" role="columnheader">
                Job
              </MarketingSpan>
              <MarketingSpan className="font-normal" role="columnheader">
                The usual tool
              </MarketingSpan>
              <MarketingSpan className="font-normal" role="columnheader">
                Oppulence
              </MarketingSpan>
            </div>
            {page.rows.map((row) => (
              <div className="mk-compare-row" key={row.label} role="row">
                <MarketingSpan className="font-normal" role="cell">
                  {row.label}
                </MarketingSpan>
                <MarketingSpan className="font-normal" role="cell">
                  {row.them}
                </MarketingSpan>
                <MarketingSpan className="font-normal" role="cell">
                  {row.us}
                </MarketingSpan>
              </div>
            ))}
          </div>
        </section>

        {page.notes.length > 0 ? (
          <ul className="mk-compare-notes">
            {page.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <MarketingFaq items={page.faqs} />
        <RelatedPages items={page.related} />
        <MarketingCta title="Evaluate it against the tools you already have." />
      </div>
    </article>
  );
}
