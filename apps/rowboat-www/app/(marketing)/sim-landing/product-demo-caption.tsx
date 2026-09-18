"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/sim/cn";

import { HOME_TYPE } from "./tokens";
import {
  PRODUCT_DEMO_BEATS,
  type ProductDemoBeatId,
} from "./product-demo-beats";
import { useProductDemoBeat } from "./product-demo-context";

const EXIT_MS = 320;
const TITLE =
  "col-start-1 row-start-1 mx-auto max-w-[26ch] text-balance text-[#3B3B3B] dark:text-[var(--text-secondary)]";

interface ProductDemoCaptionProps {
  className?: string;
}

/** Sim `ProductDemoCaption` — crossfading beat titles over the demo frame. */
export function ProductDemoCaption({ className }: ProductDemoCaptionProps) {
  const { beat } = useProductDemoBeat();
  const [shown, setShown] = useState<ProductDemoBeatId>(beat);
  const [leaving, setLeaving] = useState<ProductDemoBeatId | null>(null);
  const [changed, setChanged] = useState(false);

  if (beat !== shown) {
    setLeaving(shown);
    setShown(beat);
    setChanged(true);
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <div
      className={cn(
        "relative z-10 mx-auto grid w-full max-w-[40rem] shrink-0 text-center",
        className,
      )}
      data-product-demo-caption
    >
      {leaving && (
        <p
          aria-hidden="true"
          className={cn(
            TITLE,
            HOME_TYPE.h3,
            "pointer-events-none opacity-0 transition-opacity duration-300 ease-out motion-reduce:transition-none",
          )}
          key={leaving}
        >
          {PRODUCT_DEMO_BEATS[leaving]}
        </p>
      )}
      <h2
        className={cn(TITLE, HOME_TYPE.h3, changed && "sim-demo-caption-enter")}
        id="product-demo-heading"
        key={shown}
      >
        {PRODUCT_DEMO_BEATS[shown]}
      </h2>
    </div>
  );
}
