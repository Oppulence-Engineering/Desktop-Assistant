"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { useProductDemoBeat } from "./product-demo-context";

const CAPTION_CLEARANCE_GAP = 44;

const ComposerLoop = dynamic(
  () => import("./composer-loop").then((mod) => mod.ComposerLoop),
  { ssr: false },
);

function useLazyMount(rootMargin = "400px") {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}

/**
 * Lazy client mount for the product demo composer loop — mirrors sim.ai
 * `ProductDemoVisualMount` (clearance measurement + beat relay).
 */
export function ProductDemoVisualMount() {
  const { ref, inView } = useLazyMount();
  const { setBeat } = useProductDemoBeat();
  const [clearance, setClearance] = useState(0);

  useEffect(() => {
    const stage = ref.current;
    const caption = stage
      ?.closest("section")
      ?.querySelector<HTMLElement>("[data-product-demo-caption]");
    if (!stage || !caption) return;

    const measure = () => {
      const reach = caption.getBoundingClientRect().bottom - stage.getBoundingClientRect().top;
      setClearance(Math.max(0, Math.round(reach) + CAPTION_CLEARANCE_GAP));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(caption);
    return () => observer.disconnect();
  }, [ref]);

  return (
    <div className="absolute inset-0" data-product-demo-stage ref={ref}>
      {inView ? <ComposerLoop clearance={clearance} onBeat={setBeat} /> : null}
    </div>
  );
}
