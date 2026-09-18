import type { ReactNode } from "react";

import { cn } from "@/lib/sim/cn";

import { EdgeFade } from "../edge-fade";

interface MenuPreviewFrameProps {
  kind: string;
  children: ReactNode;
  interactive?: boolean;
  layout?: "menu" | "hero" | "stage";
}

/** Navigation crops and open hero stages share the same product UI and edge treatment. */
export function MenuPreviewFrame({
  kind,
  children,
  interactive = false,
  layout = "menu",
}: MenuPreviewFrameProps) {
  const isHero = layout === "hero";
  const isStage = layout === "stage";

  return (
    <div
      aria-hidden={interactive ? undefined : true}
      className={cn(
        "sim-product-preview isolate select-none overflow-hidden [container-type:inline-size]",
        isStage
          ? "relative size-full bg-[var(--bg)]"
          : "pointer-events-none absolute inset-0",
        !isStage && (isHero ? "bg-[var(--bg)]" : "bg-[var(--surface-3)] [--preview-content-width:576px]"),
      )}
      data-menu-preview={kind}
      data-product-preview=""
      inert={!interactive ? true : undefined}
    >
      <div
        className={cn(
          isStage &&
            "flex size-full items-center justify-center px-6 py-4 [scale:min(1,tan(atan2(100cqh,520px)))] max-sm:px-3",
          isHero &&
            "-translate-x-1/2 absolute top-20 @max-[640px]:left-6 left-1/2 w-max @max-[640px]:translate-x-0 max-sm:top-6",
          !isStage &&
            !isHero &&
            "relative w-[640px] origin-top-left p-10 [scale:min(1,tan(atan2(100cqw,640px)))]",
        )}
      >
        {children}
      </div>
      <EdgeFade
        depth="preview"
        edges={isStage ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}
        ground={isHero || isStage ? "canvas" : "surface"}
      />
    </div>
  );
}
