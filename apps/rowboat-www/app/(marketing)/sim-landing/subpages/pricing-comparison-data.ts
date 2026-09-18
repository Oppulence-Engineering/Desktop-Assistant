/** Cell values for Oppulence pricing cards — mirrors sim.ai comparison transpose. */
export type PricingCellValue = boolean | string;

export type PricingComparisonRow = {
  label: string;
  values: [PricingCellValue, PricingCellValue, PricingCellValue];
};

export type PricingComparisonSection = {
  key: string;
  title?: string;
  rows: PricingComparisonRow[];
};

/** Watch · Chase · Intelligence — one shared row order, transposed per card. */
export const PRICING_COMPARISON_SECTIONS: PricingComparisonSection[] = [
  {
    key: "evidence",
    title: "Evidence",
    rows: [
      {
        label: "6-month report with source links",
        values: [true, true, true],
      },
      {
        label: "What you owe",
        values: [true, true, true],
      },
    ],
  },
  {
    key: "register",
    title: "Register",
    rows: [
      {
        label: "Live register",
        values: [false, true, true],
      },
      {
        label: "At-risk promises",
        values: [false, true, true],
      },
      {
        label: "Approved follow-ups",
        values: [false, true, true],
      },
    ],
  },
  {
    key: "intelligence",
    title: "Intelligence",
    rows: [
      {
        label: "Change summaries",
        values: [false, false, true],
      },
      {
        label: "Exportable records",
        values: [false, false, true],
      },
    ],
  },
  {
    key: "billing",
    rows: [
      {
        label: "Flat monthly price",
        values: ["Free", "$99", "$249"],
      },
      {
        label: "Seat tax",
        values: [false, false, false],
      },
    ],
  },
];

/** Transpose shared comparison sections into one plan column for {@link SimPricingCard}. */
export function pricingSectionsForColumn(columnIndex: 0 | 1 | 2) {
  return PRICING_COMPARISON_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    rows: section.rows.map((row) => ({
      label: row.label,
      value: row.values[columnIndex],
    })),
  }));
}
