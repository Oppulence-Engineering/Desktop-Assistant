import { cn } from "@/lib/sim/cn";

import { EdgeFade } from "../../../edge-fade";
import { IsoIntegrateIllustration, IsoMonitorIllustration } from "../../../iso-marks";

interface OverviewMenuPreviewProps {
  layout?: "menu" | "hero" | "stage";
}

/** Oppulence platform overview — iso marks matching sim.ai `OverviewMenuPreview`. */
export function OverviewMenuPreview({ layout = "menu" }: OverviewMenuPreviewProps) {
  const isHero = layout === "hero" || layout === "stage";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden px-10 [container-type:inline-size]",
        isHero ? "gap-24 bg-[var(--bg)] max-sm:gap-10 max-sm:px-6" : "gap-10 bg-[var(--surface-3)]",
      )}
      data-menu-preview="overview"
      inert
    >
      <IsoIntegrateIllustration
        className="size-[min(33cqw,212px)]"
        size={212}
        variant="outline"
      />
      <IsoMonitorIllustration
        className="size-[min(33cqw,212px)]"
        size={212}
        variant="outline"
      />
      {isHero ? <EdgeFade depth="preview" edges={["top", "left", "right"]} ground="canvas" /> : null}
    </div>
  );
}
