import { cn } from "@/lib/sim/cn";

interface ChevronArrowProps {
  className?: string;
  active?: boolean;
  strokeWidth?: number;
}

/** Animated chevron for landing CTAs — ported from sim.ai `ChevronArrow`. */
export function SimChevronArrow({
  className,
  active = false,
  strokeWidth = 1.33,
}: ChevronArrowProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-3 shrink-0 text-[var(--text-muted)]", className)}
      fill="none"
      viewBox="0 0 10 10"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line
        className={cn(
          "origin-left transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100 group-focus-visible/link:scale-x-100 motion-reduce:transition-none",
          active ? "scale-x-100" : "scale-x-0",
        )}
        stroke="currentColor"
        strokeLinecap="square"
        strokeWidth={strokeWidth}
        x1="0"
        x2="9"
        y1="5"
        y2="5"
      />
      <path
        className={cn(
          "transition-transform duration-200 ease-out group-hover/link:translate-x-[30%] group-focus-visible/link:translate-x-[30%] motion-reduce:transition-none",
          active && "translate-x-[30%]",
        )}
        d="M3.5 2L6.5 5L3.5 8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="square"
        strokeLinejoin="miter"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
