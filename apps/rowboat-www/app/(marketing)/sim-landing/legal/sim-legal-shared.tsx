import { cn } from "@/lib/sim/cn";

import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from "../tokens";
import { SimCtaLink } from "../primitives";
import type { LegalRelatedLink } from "@/components/legal/types";

export function SimLegalPageMeta({
  contactEmail,
  effective,
  lastUpdated,
}: {
  contactEmail: string;
  effective: string;
  lastUpdated: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[var(--text-secondary)]">
      <span>Effective {effective}</span>
      <span aria-hidden="true">·</span>
      <a className="underline-offset-4 hover:underline" href={`mailto:${contactEmail}`}>
        {contactEmail}
      </a>
      <span aria-hidden="true">·</span>
      <span>Last updated {lastUpdated}</span>
    </div>
  );
}

export function SimLegalRelatedLinks({
  related,
  className,
}: {
  related: LegalRelatedLink[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Related legal documents"
      className={cn(
        "flex flex-wrap gap-2 border-[var(--border)] border-t pt-8",
        className,
      )}
    >
      {related.map((doc) => (
        <SimCtaLink href={doc.href} key={doc.href} size="compact" variant="outline">
          {doc.label}
        </SimCtaLink>
      ))}
      <SimCtaLink href="/contact" size="compact" variant="outline">
        Contact
      </SimCtaLink>
    </nav>
  );
}

export const SIM_LEGAL_PAGE = cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, "pb-20 max-sm:pb-14");
