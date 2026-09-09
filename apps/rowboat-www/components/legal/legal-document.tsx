import Link from "next/link";

import { CurrentYear } from "./current-year";

/**
 * A body block inside a legal section.
 *
 * - `string` renders a paragraph
 * - `string[]` renders a bullet list
 * - `{ term, text }[]` renders a definition-style list, used for the
 *   "categories of data" and "your rights" lists that the templates rely on
 * - `{ callout }` renders an emphasized box for the notices that have to stand
 *   out (arbitration, jury-trial waiver, and similar)
 */
export type LegalBlock = string | string[] | { term: string; text: string }[] | { callout: string };

export type LegalSection = {
  heading: string;
  /** Optional short lead-in shown under the heading in muted text. */
  summary?: string;
  body: LegalBlock[];
};

function isTermList(block: LegalBlock): block is { term: string; text: string }[] {
  return Array.isArray(block) && typeof block[0] === "object" && block[0] !== null;
}

function BlockContent({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return <p className="sm-legal-p">{block}</p>;
  }

  if (!Array.isArray(block)) {
    return <p className="sm-legal-callout">{block.callout}</p>;
  }

  if (isTermList(block)) {
    return (
      <dl className="sm-legal-terms">
        {block.map((item) => (
          <div key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.text}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <ul className="sm-legal-list">
      {(block as string[]).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function LegalDocument({
  title,
  effective,
  lastUpdated,
  intro,
  sections,
  contactEmail,
  related,
}: {
  title: string;
  /** Date the document takes effect, shown next to the title like the ToC. */
  effective: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  contactEmail: string;
  related: { label: string; href: string }[];
}) {
  return (
    <div className="sm-site sm-legal">
      <header className="sm-legal-header">
        <Link className="sm-legal-lockup" href="/">
          <img alt="" src="/marketing/oppulence-icon.png" />
          <span>Oppulence</span>
        </Link>
        <span className="sm-legal-header-tag">Legal</span>
      </header>

      <article className="sm-legal-body">
        <h1>{title}</h1>
        <p className="sm-legal-meta">
          Effective {effective}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>
        <p className="sm-legal-intro">{intro}</p>

        {/* On-page index. Legal documents are long, and the templates assume a
            reader who is looking for one specific section. The row count keeps
            the two columns reading top-to-bottom, left-to-right. */}
        <nav
          aria-label="Contents"
          className="sm-legal-index"
          style={
            {
              "--sm-legal-index-rows": Math.ceil(sections.length / 2),
            } as React.CSSProperties
          }
        >
          {sections.map((section) => (
            <a href={`#${slugify(section.heading)}`} key={section.heading}>
              {section.heading}
            </a>
          ))}
        </nav>

        {sections.map((section) => (
          <section id={slugify(section.heading)} key={section.heading}>
            <h2>{section.heading}</h2>
            {section.summary ? <p className="sm-legal-summary">{section.summary}</p> : null}
            {section.body.map((block, i) => (
              <BlockContent block={block} key={i} />
            ))}
          </section>
        ))}

        <p className="sm-legal-updated">Last updated: {lastUpdated}</p>
      </article>

      <footer className="sm-legal-footer">
        <span>
          © <CurrentYear /> Playbook Media · Oppulence
        </span>
        <div>
          {related.map((doc) => (
            <Link href={doc.href} key={doc.href}>
              {doc.label}
            </Link>
          ))}
          <Link href="/">Home</Link>
        </div>
      </footer>
    </div>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
