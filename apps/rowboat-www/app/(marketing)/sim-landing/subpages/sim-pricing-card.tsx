import { Check, ChipLink, ChipTag, cn } from "@sim/emcn";

import type { PricingCellValue } from "./pricing-comparison-data";

export type SimPricingCardSection = {
  key: string;
  title?: string;
  rows: { label: string; value: PricingCellValue }[];
};

export type SimPricingCardProps = {
  name: string;
  description?: string;
  price: string;
  priceSubtext?: string;
  badge?: string;
  cta: { label: string; href: string; variant?: "primary" | "border-shadow" | "outline" };
  sections: SimPricingCardSection[];
  className?: string;
};

function FeatureValue({ value }: { value: PricingCellValue }) {
  if (value === true) {
    return <Check className="size-[14px] shrink-0 text-[var(--text-icon)]" />;
  }
  if (value === false) {
    return <span className="select-none text-[var(--text-muted)]">–</span>;
  }
  return (
    <span className="whitespace-nowrap text-right text-[var(--text-primary)] text-sm tabular-nums">
      {value}
    </span>
  );
}

/** Sim `PricingCard` geometry — self-contained spec sheet per plan. */
export function SimPricingCard({
  name,
  description,
  price,
  priceSubtext,
  badge,
  cta,
  sections,
  className,
}: SimPricingCardProps) {
  const ctaVariant = cta.variant === "outline" ? "border" : (cta.variant ?? "primary");

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-[22px] rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)] p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[24px] text-[var(--text-primary)]">{name}</h2>
            {badge ? <ChipTag variant="mono">{badge}</ChipTag> : null}
          </div>
          {description ? (
            <p className="text-[var(--text-secondary)] text-sm leading-[1.45]">{description}</p>
          ) : null}
        </div>

        <div className="flex flex-col">
          <span className="text-[20px] text-[var(--text-primary)] tabular-nums">{price}</span>
          <p className="text-[var(--text-secondary)] text-base">{priceSubtext ?? "\u00a0"}</p>
        </div>

        <ChipLink className="w-full justify-center" fullWidth href={cta.href} variant={ctaVariant}>
          {cta.label}
        </ChipLink>
      </div>

      <div className="flex flex-col gap-5">
        {sections.map((section) => (
          <div className="flex flex-col" key={section.key}>
            {section.title ? (
              <>
                <span className="text-[var(--text-primary)] text-small">{section.title}</span>
                <div className="mt-2 mb-2.5 h-px bg-[var(--border)]" />
              </>
            ) : null}
            <div className="flex flex-col gap-2.5">
              {section.rows.map((row) => (
                <div className="flex items-center justify-between gap-3" key={row.label}>
                  <span className="text-[var(--text-body)] text-sm">{row.label}</span>
                  <FeatureValue value={row.value} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
