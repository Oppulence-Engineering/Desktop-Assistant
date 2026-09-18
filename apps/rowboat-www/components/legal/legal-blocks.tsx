import { cn } from "@/lib/sim/cn";

import type { LegalBlock, LegalSection } from "./types";
import { legalSectionSlug } from "./legal-slug";

function isTermList(block: LegalBlock): block is { term: string; text: string }[] {
  return Array.isArray(block) && typeof block[0] === "object" && block[0] !== null;
}

export function LegalBlockContent({
  block,
  calloutClassName,
}: {
  block: LegalBlock;
  calloutClassName?: string;
}) {
  if (typeof block === "string") {
    return (
      <p className="text-[15px] text-[var(--text-body)] leading-[1.65]">{block}</p>
    );
  }

  if (!Array.isArray(block)) {
    return (
      <p
        className={cn(
          "rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[14px] text-[var(--text-primary)] leading-[1.55]",
          calloutClassName,
        )}
      >
        {block.callout}
      </p>
    );
  }

  if (isTermList(block)) {
    return (
      <dl className="flex flex-col gap-4">
        {block.map((item) => (
          <div className="flex flex-col gap-1" key={item.term}>
            <dt className="text-[14px] text-[var(--text-primary)]">{item.term}</dt>
            <dd className="text-[15px] text-[var(--text-body)] leading-[1.6]">{item.text}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5 pl-5 text-[15px] text-[var(--text-body)] leading-[1.6] [list-style:disc]">
      {(block as string[]).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function LegalSectionContent({
  section,
  calloutClassName,
  headingLevel = "h2",
}: {
  section: LegalSection;
  calloutClassName?: string;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;

  return (
    <section id={legalSectionSlug(section.heading)}>
      <Heading className="text-[22px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em] max-sm:text-[20px]">
        {section.heading}
      </Heading>
      {section.summary ? (
        <p className="mt-2 text-[14px] text-[var(--text-secondary)] leading-[1.55]">
          {section.summary}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-4">
        {section.body.map((block, index) => (
          <LegalBlockContent block={block} calloutClassName={calloutClassName} key={index} />
        ))}
      </div>
    </section>
  );
}

/** Pull the first bullet list from a section body — used for scope cards on disclosure. */
export function legalSectionBulletList(section: LegalSection): string[] {
  for (const block of section.body) {
    if (Array.isArray(block) && !isTermList(block)) {
      return block as string[];
    }
  }
  return [];
}
