"use client";

import { cn } from "@/lib/sim/cn";

import {
  AccountMenuPreview,
  DesktopMenuPreview,
  GovernMenuPreview,
  OverviewMenuPreview,
  RegisterMenuPreview,
  type ProductPreviewKey,
  VoiceMenuPreview,
  WebMenuPreview,
} from "./product-previews";
import { PRODUCT_STAGE_ENTER } from "./product-stage-preview";

const PREVIEWS = {
  overview: OverviewMenuPreview,
  register: RegisterMenuPreview,
  web: WebMenuPreview,
  desktop: DesktopMenuPreview,
  voice: VoiceMenuPreview,
  account: AccountMenuPreview,
  govern: GovernMenuPreview,
} as const;

interface ProductHeroPreviewProps {
  product: ProductPreviewKey;
  compact?: boolean;
}

/** Feature-page heroes render the same UI as the corresponding navigation preview. */
export function ProductHeroPreview({ product, compact = false }: ProductHeroPreviewProps) {
  const Preview = PREVIEWS[product];

  return (
    <div
      className={cn(
        "sim-product-preview relative isolate overflow-hidden",
        compact
          ? "h-full min-h-[240px]"
          : "h-[420px] max-lg:h-[400px]",
        !compact && product !== "govern" && "max-sm:h-[320px]",
      )}
      data-product-hero={product}
      data-product-preview=""
    >
      <div className={cn("absolute inset-0", !compact && PRODUCT_STAGE_ENTER)}>
        <Preview layout={compact ? "stage" : "hero"} />
      </div>
    </div>
  );
}
