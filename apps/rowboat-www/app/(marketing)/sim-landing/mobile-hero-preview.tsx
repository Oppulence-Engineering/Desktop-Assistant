import { cn } from "@/lib/sim/cn";

import { EdgeFade } from "./edge-fade";

const blocks = [
  {
    title: "Read mail",
    body: "Find sentences that look like promises.",
    x: "left-[5px] top-[185px]",
  },
  {
    title: "Confirm rows",
    body: "Keep the ones that count. Drop the rest.",
    x: "left-[325px] top-[75px]",
    selected: true,
  },
  {
    title: "Hold the gate",
    body: "Draft the follow-up. Wait for approval.",
    x: "left-[645px] top-[165px]",
  },
] as const;

/** Sim `MobileHeroWorkflow` geometry with Oppulence commitment steps and shared edge fades. */
export function SimMobileHeroPreview() {
  return (
    <div
      aria-label="Oppulence workflow: read mail, confirm commitments, hold drafts for approval"
      className="relative isolate mt-12 h-[300px] w-[calc(100%+56px)] overflow-hidden max-lg:-mx-7 max-lg:md:-mx-8 max-lg:md:w-[calc(100%+64px)] lg:hidden"
      role="img"
    >
      <div
        aria-hidden="true"
        className="absolute top-0 left-1/2 h-[340px] w-[900px] origin-top -translate-x-1/2 scale-[0.85]"
      >
        <svg
          className="absolute inset-0 size-full overflow-visible"
          fill="none"
          viewBox="0 0 900 340"
        >
          <path
            d="M165 220 C 245 220, 245 120, 325 120"
            stroke="var(--text-secondary)"
            strokeWidth={1.5}
          />
          <path
            d="M485 120 C 565 120, 565 200, 645 200"
            stroke="var(--text-secondary)"
            strokeWidth={1.5}
          />
        </svg>
        {blocks.map((block) => (
          <div className={cn("absolute w-[150px]", block.x)} key={block.title}>
            <div
              className={cn(
                "rounded-lg border bg-[var(--surface-2)] p-3 shadow-xs",
                "selected" in block && block.selected
                  ? "border-[var(--text-primary)]"
                  : "border-[var(--border)]",
              )}
            >
              <p className="text-[12px] font-medium text-[var(--text-primary)]">{block.title}</p>
              <p className="mt-1 text-[11px] leading-[1.4] text-[var(--text-body)]">{block.body}</p>
            </div>
          </div>
        ))}
      </div>
      <EdgeFade depth="stage" edges={["left", "right"]} ground="canvas" />
      <EdgeFade depth="preview" edges={["top", "bottom"]} ground="canvas" />
    </div>
  );
}
