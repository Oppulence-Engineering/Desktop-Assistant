"use client";

import { cn } from "@/lib/sim/cn";

import { TablesRecordsPreview } from "../../tables-records-preview";
import { ProductModulePreview } from "./product-module-preview";
import type { ProductPreviewKey } from "./product-previews";

/** Sim product-hero reveal — matches sim.ai entrance on feature pages. */
export const PRODUCT_STAGE_ENTER =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:fill-mode-backwards motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:slide-in-from-bottom-3 motion-safe:zoom-in-[0.985] motion-reduce:transition-none";

interface ProductStagePreviewProps {
  product: ProductPreviewKey | "register-interactive";
  /** Register tab uses the interactive tables surface from the homepage resource pane. */
  interactive?: boolean;
  className?: string;
}

/**
 * Fills a showcase or explorer stage with a live product surface.
 * Register can be fully interactive; other modules use centered stage layout.
 */
export function ProductStagePreview({
  product,
  interactive = false,
  className,
}: ProductStagePreviewProps) {
  const useInteractiveRegister =
    product === "register-interactive" || (interactive && product === "register");

  return (
    <div
      className={cn("relative size-full min-h-[360px]", PRODUCT_STAGE_ENTER, className)}
      data-product-stage={product}
    >
      {useInteractiveRegister ? (
        <TablesRecordsPreview layout="stage" />
      ) : (
        <ProductModulePreview layout="stage" product={product as ProductPreviewKey} />
      )}
    </div>
  );
}
