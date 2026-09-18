import type { CSSProperties, SVGProps } from "react";

import styles from "./iso-marks.module.css";

/** The ground a mark sits on — lighter or darker tile in either theme. */
export type IsoTone = "light" | "dark";

const ISO_VIEWBOX_SIZE = 526.5434455009386;

export const ISO_PALETTE = {
  stroke: "var(--iso-stroke)",
  low: "var(--iso-low)",
  mid: "var(--iso-mid)",
  high: "var(--iso-high)",
} as const;

export const ISO_TONE_CLASS: Readonly<Record<IsoTone, string>> = {
  light: styles.onLight,
  dark: styles.onDark,
};

export function createIsoLineProps(
  className: string,
  variant: "filled" | "outline",
  size: number,
): SVGProps<SVGPathElement> {
  return {
    className,
    fill: "none",
    pathLength: 1,
    pointerEvents: "none",
    opacity: 1,
    style: { stroke: ISO_PALETTE.stroke },
    strokeWidth: variant === "filled" ? ISO_VIEWBOX_SIZE / size : 3.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
}

export function withIsoFace(
  lineProps: SVGProps<SVGPathElement>,
  fill: string,
): SVGProps<SVGPathElement> {
  return { ...lineProps, style: { ...(lineProps.style as CSSProperties | undefined), fill } };
}
