import Link from "next/link";

import { LegalSectionContent } from "@/components/legal/legal-blocks";
import { legalSectionSlug } from "@/components/legal/legal-slug";
import type { LegalRelatedLink, LegalSection } from "@/components/legal/types";

import { SIM_LEGAL_PAGE, SimLegalPageMeta, SimLegalRelatedLinks } from "./sim-legal-shared";

/** Shared legal layout — sticky table of contents + reading column (same as /privacy). */
export function SimLegalDocumentPage({
  eyebrow,
  title,
  effective,
  lastUpdated,
  intro,
  sections,
  contactEmail,
  related,
}: {
  eyebrow: string;
  title: string;
  effective: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  contactEmail: string;
  related: LegalRelatedLink[];
}) {
  return (
    <article className={SIM_LEGAL_PAGE}>
      <header className="max-w-[760px] pb-10">
        <p className="text-[12px] text-[var(--text-muted)] uppercase tracking-[0.08em]">
          {eyebrow}
        </p>
        <h1
          className="mt-3 max-w-[18ch] text-balance text-[40px] text-[var(--text-primary)] leading-[1.05] tracking-[-0.025em] max-sm:text-[32px] lg:text-[48px]"
          id="legal-heading"
        >
          {title}
        </h1>
        <div className="mt-4">
          <SimLegalPageMeta
            contactEmail={contactEmail}
            effective={effective}
            lastUpdated={lastUpdated}
          />
        </div>
        <p className="mt-5 max-w-[56ch] text-[17px] text-[var(--text-body)] leading-[1.6] max-sm:text-base">
          {intro}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:gap-14">
        <nav aria-label="Contents" className="lg:sticky lg:top-28 lg:self-start">
          <p className="mb-3 text-[12px] text-[var(--text-muted)] uppercase tracking-[0.06em]">
            On this page
          </p>
          <ol className="flex flex-col gap-2 border-[var(--border)] max-lg:border-b max-lg:pb-8 lg:border-l lg:pl-4">
            {sections.map((section) => (
              <li key={section.heading}>
                <Link
                  className="block text-[14px] text-[var(--text-secondary)] leading-[1.45] transition-colors hover:text-[var(--text-primary)]"
                  href={`#${legalSectionSlug(section.heading)}`}
                >
                  {section.heading}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-12 border-[var(--border)] lg:border-l lg:pl-10">
          {sections.map((section) => (
            <LegalSectionContent key={section.heading} section={section} />
          ))}
        </div>
      </div>

      <SimLegalRelatedLinks className="mt-12" related={related} />
    </article>
  );
}

/** @deprecated Use {@link SimLegalDocumentPage} */
export const SimLegalPrivacyPage = SimLegalDocumentPage;
