"use client";

import Link from "next/link";

import { cn } from "@/lib/sim/cn";

import { ProductModulePreview } from "./subpages/solutions-product/product-module-preview";
import type { ProductPreviewKey } from "./subpages/solutions-product/product-previews";
import { LANDING_STAGE_RADIUS } from "./tokens";

interface FeaturesRailCardProps {
  description: string;
  eyebrow: string;
  href: string;
  preview: ProductPreviewKey;
}

/** Feature rail tile — live product chrome, distinct preview per capability. */
export function FeaturesRailCard({ description, eyebrow, href, preview }: FeaturesRailCardProps) {
  return (
    <article className="min-w-0">
      <Link
        className="group block outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--border)] focus-visible:outline-offset-4"
        href={href}
      >
        <div
          aria-hidden="true"
          className={cn(
            "relative aspect-[5/6] overflow-hidden border border-[var(--border)] bg-[var(--surface-3)] transition-colors duration-300 group-hover:border-[var(--border)] motion-reduce:transition-none",
            LANDING_STAGE_RADIUS,
          )}
        >
          <ProductModulePreview layout="menu" product={preview} />
        </div>
        <h3 className="mt-5 text-[20px] leading-[1.25] tracking-[-0.01em] text-[var(--text-primary)]">
          {eyebrow}
        </h3>
        <p className="mt-2 max-w-[36ch] text-pretty text-[15px] leading-[1.45] text-[var(--text-body)]">
          {description}
        </p>
      </Link>
    </article>
  );
}
