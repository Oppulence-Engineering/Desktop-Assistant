import { cn } from "@/lib/sim/cn";

import styles from "./edge-fade.module.css";

export type Edge = "top" | "bottom" | "left" | "right";

const ALL_EDGES = ["top", "bottom", "left", "right"] as const satisfies readonly Edge[];

const STRIP = "pointer-events-none absolute z-[5]";

const PLACE = {
  top: "inset-x-0 top-0",
  bottom: "inset-x-0 bottom-0",
  left: "inset-y-0 left-0",
  right: "inset-y-0 right-0",
} as const satisfies Record<Edge, string>;

const DIRECTION = {
  top: styles.edgeTop,
  bottom: styles.edgeBottom,
  left: styles.edgeLeft,
  right: styles.edgeRight,
} as const satisfies Record<Edge, string>;

const WASH = {
  top: "bg-gradient-to-b",
  bottom: "bg-gradient-to-t",
  left: "bg-gradient-to-r",
  right: "bg-gradient-to-l",
} as const satisfies Record<Edge, string>;

const RAMP = [styles.layer0, styles.layer1, styles.layer2, styles.layer3, styles.layer4] as const;

const AXIS = { top: "y", bottom: "y", left: "x", right: "x" } as const;

const DEPTH = {
  preview: { x: "w-10", y: "h-10" },
  stage: { x: "w-[72px] lg:w-[144px]", y: "h-[96px] lg:h-[128px]" },
  bleed: { x: "w-[144px] max-md:w-7 max-lg:w-8", y: "h-[128px] max-md:h-7 max-lg:h-8" },
} as const;

const GROUND = {
  surface: "from-[var(--surface-3)]",
  canvas: "from-[var(--bg)]",
  paper: "from-[#F8F8F8] dark:from-[var(--surface-2)]",
} as const;

interface EdgeFadeProps {
  ground: keyof typeof GROUND;
  edges?: readonly Edge[];
  depth?: keyof typeof DEPTH;
}

/** Blurred, fading edges on a scene — ported from sim.ai `EdgeFade`. */
export function EdgeFade({ ground, edges = ALL_EDGES, depth = "stage" }: EdgeFadeProps) {
  return (
    <>
      {edges.map((edge) => (
        <div
          className={cn(STRIP, DIRECTION[edge], PLACE[edge], DEPTH[depth][AXIS[edge]])}
          key={edge}
        >
          {RAMP.map((layer) => (
            <div className={cn(styles.layer, layer)} key={layer} />
          ))}
          <div className={cn(styles.wash, WASH[edge], GROUND[ground], "to-transparent")} />
        </div>
      ))}
    </>
  );
}
