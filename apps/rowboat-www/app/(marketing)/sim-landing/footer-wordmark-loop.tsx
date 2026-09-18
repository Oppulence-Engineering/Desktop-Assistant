"use client";

import { type CSSProperties, useEffect, useId, useRef } from "react";

import { cn } from "@/lib/sim/cn";

const INK_STOP_INNER = { stopColor: "var(--thinking-ink-inner)" } as const satisfies CSSProperties;
const INK_STOP_OUTER = { stopColor: "var(--thinking-ink-outer)" } as const satisfies CSSProperties;

/** Shape holds and timing constants from sim.ai's footer wordmark generator. */
const SHAPES = [
  ["metaballs", 2000],
  ["relay", 1300],
  ["compass", 2000],
  ["corners", 800],
  ["burst", 1300],
  ["squeeze", 1200],
  ["thinking", 2000],
] as const;

type ShapeKey = (typeof SHAPES)[number][0];
type StageKey = ShapeKey | "orb" | "wm";

const MORPH = 500;
const MORPH_LOGO = 1200;
const LOGO_HOLD = 1300;
const ORB_BEAT = 450;
const HOLD_LOGO_END = 1700;
const TAIL = 200;
const GOO_HI = 5;
const GOO_LO = 0.55;
const LOCAL_PULSE: Partial<Record<ShapeKey, number>> = { burst: 770 };
const MAX_FRAME_STEP = 100;

const T_LOGO_HOLD_END = LOGO_HOLD;
const T_INTRO_END = T_LOGO_HOLD_END + MORPH_LOGO;
const FIRST_SHAPE_START = T_INTRO_END + ORB_BEAT;

function buildShapeWindows(): {
  windows: Record<ShapeKey, readonly [number, number]>;
  end: number;
} {
  const windows: Partial<Record<ShapeKey, readonly [number, number]>> = {};
  let cursor = FIRST_SHAPE_START;
  for (const [key, hold] of SHAPES) {
    windows[key] = [cursor, cursor + hold];
    cursor += hold;
  }
  return { windows: windows as Record<ShapeKey, readonly [number, number]>, end: cursor };
}

const { windows: SHAPE_WINDOWS, end: SHAPES_END } = buildShapeWindows();
const T_OUTRO_START = SHAPES_END + ORB_BEAT;
const T_OUTRO_END = T_OUTRO_START + MORPH_LOGO;
const CYCLE_MS = T_OUTRO_END + HOLD_LOGO_END + TAIL;

interface Track {
  dur: number;
  alt?: boolean;
  lin?: boolean;
  stops: ReadonlyArray<readonly [number, number, number]>;
  op?: ReadonlyArray<readonly [number, number]>;
}

const TRACKS = {
  metaballsA: {
    dur: 1000,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.9, 28, 0],
      [1, 28, 0],
    ],
  },
  metaballsB: {
    dur: 1000,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.9, -28, 0],
      [1, -28, 0],
    ],
  },
  relayBall: {
    dur: 1300,
    lin: true,
    stops: [
      [0, 0, 0],
      [1, 58, 0],
    ],
    op: [
      [0, 0],
      [0.2, 1],
      [0.78, 1],
      [1, 0],
    ],
  },
  compassMover: {
    dur: 2000,
    stops: [
      [0, 0, 0],
      [0.25, 27, 27],
      [0.5, 0, 54],
      [0.75, -27, 27],
      [1, 0, 0],
    ],
  },
  cornersA: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 46, 0],
    ],
  },
  cornersB: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, 46],
    ],
  },
  cornersC: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, -46, 0],
    ],
  },
  cornersD: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, -46],
    ],
  },
  burstUp: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, -50],
    ],
  },
  burstDown: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 0, 50],
    ],
  },
  burstLeft: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, -50, 0],
    ],
  },
  burstRight: {
    dur: 800,
    stops: [
      [0, 0, 0],
      [1, 50, 0],
    ],
  },
  squeezeBarL: {
    dur: 600,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.3, 0, 0],
      [1, 10, 0],
    ],
  },
  squeezeBarR: {
    dur: 600,
    alt: true,
    stops: [
      [0, 0, 0],
      [0.3, 0, 0],
      [1, -10, 0],
    ],
  },
  thinkA: {
    dur: 1600,
    alt: true,
    stops: [
      [0, 0, 0],
      [1, -20, -14],
    ],
  },
  thinkB: {
    dur: 1900,
    alt: true,
    stops: [
      [0, 0, 0],
      [1, 22, -10],
    ],
  },
  thinkC: {
    dur: 1300,
    alt: true,
    stops: [
      [0, 0, 0],
      [1, 2, 22],
    ],
  },
} as const satisfies Record<string, Track>;

type AnimKey = keyof typeof TRACKS;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number): (progress: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (progress) => {
    let t = progress;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - progress;
      if (Math.abs(error) < 1e-6) break;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    return sampleY(clamp01(t));
  };
}

const EASE = cubicBezier(0.25, 0.1, 0.25, 1);
const LINEAR = (progress: number): number => progress;

function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function envelope(t: number, t0: number, t1: number, t2: number, t3: number): number {
  return Math.min(smooth(t0, t1, t), 1 - smooth(t2, t3, t));
}

function segment<T extends readonly [number, ...number[]]>(
  stops: ReadonlyArray<T>,
  frac: number,
): { a: T; b: T; p: number } {
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (frac >= stops[i][0] && frac <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  return { a, b, p: clamp01((frac - a[0]) / span) };
}

interface Sample {
  x: number;
  y: number;
  opacity: number;
}

function sampleTrack(track: Track, at: number): Sample {
  const raw = at / track.dur;
  const iteration = Math.floor(raw);
  let frac = raw - iteration;
  if (track.alt && iteration % 2 === 1) frac = 1 - frac;
  const { a, b, p } = segment(track.stops, frac);
  const eased = (track.lin ? LINEAR : EASE)(p);
  const x = a[1] + (b[1] - a[1]) * eased;
  const y = a[2] + (b[2] - a[2]) * eased;
  let opacity = 1;
  if (track.op) {
    const o = segment(track.op, frac);
    opacity = o.a[1] + (o.b[1] - o.a[1]) * o.p;
  }
  return { x, y, opacity };
}

const round = (n: number): string => n.toFixed(3);

interface AnimatedNode {
  el: SVGGraphicsElement;
  track: Track;
  stage: ShapeKey;
}

interface StageNode {
  el: SVGGElement;
  key: StageKey;
}

interface GooFilterNodes {
  blur: SVGFEGaussianBlurElement;
  matrix: SVGFEColorMatrixElement;
}

function paintFrame(
  t: number,
  goo: GooFilterNodes,
  stages: StageNode[],
  anims: AnimatedNode[],
): void {
  for (const { el, track, stage } of anims) {
    const pulse = LOCAL_PULSE[stage];
    const clock =
      pulse === undefined
        ? t
        : Math.max(0, Math.min(t - (SHAPE_WINDOWS[stage][0] + MORPH / 2), pulse));
    const sample = sampleTrack(track, clock);
    el.setAttribute("transform", `translate(${round(sample.x)} ${round(sample.y)})`);
    if (track.op) el.setAttribute("opacity", sample.opacity.toFixed(4));
  }

  const introLogo = 1 - smooth(T_LOGO_HOLD_END, T_INTRO_END, t);
  const outroLogo = smooth(T_OUTRO_START, T_OUTRO_END, t);
  const logo = Math.max(introLogo, outroLogo);
  const orbIn = envelope(
    t,
    T_LOGO_HOLD_END,
    T_INTRO_END,
    FIRST_SHAPE_START - MORPH / 2,
    FIRST_SHAPE_START + MORPH / 2,
  );
  const orbOut = envelope(
    t,
    SHAPES_END - MORPH / 2,
    SHAPES_END + MORPH / 2,
    T_OUTRO_START,
    T_OUTRO_END,
  );
  const orb = Math.max(orbIn, orbOut);

  for (const { el, key } of stages) {
    let opacity: number;
    if (key === "wm") opacity = logo;
    else if (key === "orb") opacity = orb;
    else {
      const [start, end] = SHAPE_WINDOWS[key];
      opacity = envelope(t, start - MORPH / 2, start + MORPH / 2, end - MORPH / 2, end + MORPH / 2);
    }
    el.setAttribute("opacity", opacity.toFixed(4));
  }

  const liquid = Math.min(
    smooth(T_LOGO_HOLD_END, T_INTRO_END, t),
    1 - smooth(T_OUTRO_START, T_OUTRO_END, t),
  );
  const strength = Math.min(
    smooth(T_LOGO_HOLD_END, T_LOGO_HOLD_END + MORPH, t),
    1 - smooth(T_OUTRO_END - MORPH, T_OUTRO_END, t),
  );
  const deviation = round((GOO_LO + (GOO_HI - GOO_LO) * liquid) * strength);
  if (goo.blur.getAttribute("stdDeviation") !== deviation) {
    goo.blur.setAttribute("stdDeviation", deviation);
  }
  const matrix = `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${round(1 + 39 * strength)} ${round(-19 * strength)}`;
  if (goo.matrix.getAttribute("values") !== matrix) goo.matrix.setAttribute("values", matrix);
}

/**
 * Sim footer wordmark loader film with Oppulence lettering instead of Sim SVG paths.
 * Timeline, tracks, goo filter, and stage geometry match sim.ai 1:1.
 */
export function FooterWordmarkLoop({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const gooId = `fwl-goo-${id}`;
  const inkId = `fwl-ink-${id}`;
  const wordmarkInkId = `fwl-wm-ink-${id}`;
  const clipId = `fwl-clip-${id}`;
  const windowId = `fwl-window-${id}`;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const blur = svg.querySelector<SVGFEGaussianBlurElement>("[data-goo]");
    const matrix = svg.querySelector<SVGFEColorMatrixElement>("[data-goo-matrix]");
    if (!blur || !matrix) return;
    const goo: GooFilterNodes = { blur, matrix };

    const stages: StageNode[] = Array.from(
      svg.querySelectorAll<SVGGElement>("[data-stage]"),
      (el) => ({ el, key: el.getAttribute("data-stage") as StageKey }),
    );
    const anims: AnimatedNode[] = [];
    for (const el of svg.querySelectorAll<SVGGraphicsElement>("[data-anim]")) {
      const stage = el.closest("[data-stage]")?.getAttribute("data-stage") as ShapeKey | undefined;
      const animKey = el.getAttribute("data-anim") as AnimKey | null;
      if (stage && animKey && animKey in TRACKS) {
        anims.push({ el, track: TRACKS[animKey], stage });
      }
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame: number | null = null;
    let previous: number | null = null;
    let elapsed = 0;
    let inView = false;

    const tick = (now: number) => {
      if (previous !== null) elapsed += Math.min(now - previous, MAX_FRAME_STEP);
      previous = now;
      paintFrame(elapsed % CYCLE_MS, goo, stages, anims);
      frame = requestAnimationFrame(tick);
    };

    const play = () => {
      if (frame !== null || !inView || reducedMotion?.matches) return;
      previous = null;
      frame = requestAnimationFrame(tick);
    };

    const pause = () => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };

    const onMotionPreference = () => {
      if (reducedMotion?.matches) {
        pause();
        elapsed = 0;
        paintFrame(0, goo, stages, anims);
      } else {
        play();
      }
    };
    reducedMotion?.addEventListener("change", onMotionPreference);

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") {
      inView = true;
      play();
    } else {
      observer = new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        if (inView) play();
        else pause();
      });
      observer.observe(svg);
    }

    return () => {
      pause();
      observer?.disconnect();
      reducedMotion?.removeEventListener("change", onMotionPreference);
    };
  }, []);

  return (
    <div className={cn("relative mx-auto aspect-[5/3] w-[clamp(180px,17vw,320px)]", className)}>
      <svg
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 aspect-square w-full -translate-y-1/2 overflow-visible"
        ref={svgRef}
        viewBox="0 0 100 100"
      >
        <defs>
          <filter
            colorInterpolationFilters="sRGB"
            height="160%"
            id={gooId}
            width="160%"
            x="-30%"
            y="-30%"
          >
            <feGaussianBlur data-goo="" in="SourceGraphic" result="blur" stdDeviation={0} />
            <feColorMatrix
              data-goo-matrix=""
              in="blur"
              result="goo"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"
            />
          </filter>
          <radialGradient cx="0.5" cy="0.5" id={inkId} r="0.5">
            <stop style={INK_STOP_INNER} />
            <stop offset="1" style={INK_STOP_OUTER} />
          </radialGradient>
          <radialGradient cx="0.5" cy="0.5" id={wordmarkInkId} r="0.5">
            <stop style={INK_STOP_INNER} />
            <stop offset="1" style={INK_STOP_OUTER} />
          </radialGradient>
          <clipPath id={clipId}>
            <rect height="100" width="100" />
          </clipPath>
          <clipPath id={windowId}>
            <rect height="75" width="75" x="12.5" y="12.5" />
          </clipPath>
        </defs>

        <g fill={`url(#${inkId})`} filter={`url(#${gooId})`} stroke={`url(#${inkId})`} strokeWidth={0}>
          <g clipPath={`url(#${clipId})`} data-stage="metaballs" opacity={0}>
            <circle cx="22" cy="50" data-anim="metaballsA" r="16" />
            <circle cx="78" cy="50" data-anim="metaballsB" r="16" />
          </g>
          <g clipPath={`url(#${clipId})`} data-stage="relay" opacity={0}>
            <rect height="44" width="16" x="13" y="28" />
            <rect height="44" width="16" x="71" y="28" />
            <circle cx="21" cy="50" data-anim="relayBall" r="14" />
          </g>
          <g clipPath={`url(#${clipId})`} data-stage="compass" opacity={0}>
            <circle cx="50" cy="23" r="14" />
            <circle cx="23" cy="50" r="14" />
            <circle cx="77" cy="50" r="14" />
            <circle cx="50" cy="77" r="14" />
            <circle cx="50" cy="23" data-anim="compassMover" r="14" />
          </g>
          <g clipPath={`url(#${clipId})`} data-stage="corners" opacity={0}>
            <rect height="46" width="46" x="27" y="27" />
            <circle cx="27" cy="27" data-anim="cornersA" r="14" />
            <circle cx="73" cy="27" data-anim="cornersB" r="14" />
            <circle cx="73" cy="73" data-anim="cornersC" r="14" />
            <circle cx="27" cy="73" data-anim="cornersD" r="14" />
          </g>
          <g clipPath={`url(#${windowId})`} data-stage="burst" opacity={0}>
            <rect height="12.5" width="75" x="12.5" y="43.75" />
            <rect height="75" width="12.5" x="43.75" y="12.5" />
            <circle cx="50" cy="50" r="12.5" />
            <circle cx="50" cy="50" data-anim="burstUp" r="12.5" />
            <circle cx="50" cy="50" data-anim="burstDown" r="12.5" />
            <circle cx="50" cy="50" data-anim="burstLeft" r="12.5" />
            <circle cx="50" cy="50" data-anim="burstRight" r="12.5" />
          </g>
          <g clipPath={`url(#${clipId})`} data-stage="squeeze" opacity={0}>
            <path
              d="M 21.36 37.5 A 31.25 31.25 0 0 1 78.64 37.5"
              fill="none"
              strokeWidth="12.5"
            />
            <path
              d="M 21.36 62.5 A 31.25 31.25 0 0 0 78.64 62.5"
              fill="none"
              strokeWidth="12.5"
            />
            <rect data-anim="squeezeBarL" height="25" width="12.5" x="15" y="37.5" />
            <rect data-anim="squeezeBarR" height="25" width="12.5" x="72.5" y="37.5" />
          </g>
          <g clipPath={`url(#${clipId})`} data-stage="thinking" opacity={0}>
            <circle cx="50" cy="50" r="15" />
            <circle cx="50" cy="50" data-anim="thinkA" r="12" />
            <circle cx="50" cy="50" data-anim="thinkB" r="12" />
            <circle cx="50" cy="50" data-anim="thinkC" r="11" />
          </g>
          <g data-stage="orb" opacity={0}>
            <circle cx="50" cy="50" r="42" />
          </g>
          <g data-stage="wm" fill={`url(#${wordmarkInkId})`} opacity={1}>
            <text
              dominantBaseline="middle"
              fontFamily="var(--font-marketing-sans), Inter, ui-sans-serif, system-ui, sans-serif"
              fontSize="11"
              fontWeight="600"
              letterSpacing="-0.08em"
              textAnchor="middle"
              x="50"
              y="50.5"
            >
              Oppulence
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
