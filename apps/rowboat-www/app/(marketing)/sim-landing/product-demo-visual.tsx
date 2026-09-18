"use client";

import { cn } from "@/lib/sim/cn";

import { EdgeFade } from "./edge-fade";
import { ProductDemoVisualMount } from "./product-demo-visual-mount";

const EDGE_STRIP =
  "pointer-events-none absolute z-[5] [--paper:#F8F8F8] dark:[--paper:var(--surface-2)]";
const COPY_BAND =
  "inset-x-0 h-[96px] lg:h-[calc(13%+80px)] [mask-image:linear-gradient(to_right,transparent_15%,black_34%,black_66%,transparent_85%)]";
const COPY_BLUR = "absolute inset-0 backdrop-blur-[8px]";
const COPY_TOP_MASK = "[mask-image:linear-gradient(to_bottom,black_calc(100%-40px),transparent)]";
const COPY_BOTTOM_MASK = "[mask-image:linear-gradient(to_top,black_calc(100%-40px),transparent)]";

function CopyBands() {
  return (
    <>
      <div className={cn(EDGE_STRIP, COPY_BAND, "top-0")} data-copy-band="top">
        <div
          className={cn(
            COPY_BLUR,
            COPY_TOP_MASK,
            "bg-gradient-to-b from-[var(--paper)] to-transparent",
          )}
        />
      </div>
      <div className={cn(EDGE_STRIP, COPY_BAND, "bottom-0")} data-copy-band="bottom">
        <div
          className={cn(
            COPY_BLUR,
            COPY_BOTTOM_MASK,
            "bg-gradient-to-t from-[var(--paper)] to-transparent",
          )}
        />
      </div>
    </>
  );
}

/** Sim product demo scene: composer loop, edge fades, and copy bands. */
export function ProductDemoScene() {
  return (
    <div
      aria-hidden="true"
      className="sim-product-preview pointer-events-none relative min-h-[300px] w-full flex-1 select-none overflow-hidden lg:absolute lg:inset-0 lg:min-h-0"
      data-product-preview=""
      inert
    >
      <ProductDemoVisualMount />
      <EdgeFade ground="paper" />
      <CopyBands />
    </div>
  );
}
