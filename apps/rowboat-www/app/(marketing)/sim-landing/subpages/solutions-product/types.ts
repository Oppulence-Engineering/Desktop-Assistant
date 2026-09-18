import type { ReactNode } from "react";

/** Pill CTA on a product feature block. */
export type SolutionsPillCta = {
  label: string;
  href: string;
};

/** Hero copy and visual for Sim-style product pages. */
export type SolutionsHeroConfig = {
  eyebrow?: string;
  heading: string;
  description: string;
  /** sr-only GEO summary — names Oppulence explicitly. */
  summary: string;
  visual: ReactNode;
};

/** One interactive or screenshot demonstration with caption. */
export type SolutionsProductFeatureConfig = {
  id: string;
  label: string;
  title: string;
  description: string;
  visual: ReactNode;
  visualSize?: "default" | "compact";
  cta?: SolutionsPillCta;
};

/** Complete content contract for {@link SimSolutionsProductPage}. */
export type SolutionsProductPageConfig = {
  module: string;
  path: string;
  seoDescription?: string;
  hero: SolutionsHeroConfig;
  features: readonly SolutionsProductFeatureConfig[];
};
