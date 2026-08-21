import type { DictationFlowBarDock } from "@x/shared/transcription";

export type NativeHotkeyPhase = "ready" | "pressed" | "released" | "hands-free-toggle";
export type HotkeyEvent = { type: "hotkey"; phase: NativeHotkeyPhase };
export type DictationShortcutAction =
  | "pressed"
  | "released"
  | "hands-free-locked"
  | "hands-free-stop";

export function parseHotkeyEvent(line: string): HotkeyEvent | null {
  try {
    const value = JSON.parse(line) as Partial<HotkeyEvent>;
    if (
      value.type === "hotkey" &&
      (value.phase === "ready" ||
        value.phase === "pressed" ||
        value.phase === "released" ||
        value.phase === "hands-free-toggle")
    ) {
      return value as HotkeyEvent;
    }
  } catch {
    // One malformed helper line must not stop desktop dictation for the rest of
    // the app session.
  }
  return null;
}

interface GestureControllerOptions {
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  quickTapMilliseconds?: number;
  doubleTapWindowMilliseconds?: number;
}

/**
 * Converts raw modifier edges into push-to-talk or hands-free actions.
 *
 * A short first release is deferred just long enough to recognize a second tap.
 * Long dictations still release immediately, so ordinary release-to-ASR latency is
 * unchanged. The controller is platform-agnostic and deterministic under tests.
 */
export class DictationGestureController {
  private readonly emit: (action: DictationShortcutAction) => void;
  private readonly now: () => number;
  private readonly setTimer: GestureControllerOptions["setTimer"];
  private readonly clearTimer: GestureControllerOptions["clearTimer"];
  private readonly quickTapMilliseconds: number;
  private readonly doubleTapWindowMilliseconds: number;
  private pressedAt: number | null = null;
  private pendingRelease: ReturnType<typeof setTimeout> | null = null;
  private handsFreeLocked = false;
  private suppressNextRelease = false;

  constructor(
    emit: (action: DictationShortcutAction) => void,
    options: GestureControllerOptions = {},
  ) {
    this.emit = emit;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.quickTapMilliseconds = options.quickTapMilliseconds ?? 260;
    this.doubleTapWindowMilliseconds = options.doubleTapWindowMilliseconds ?? 300;
  }

  handle(phase: Exclude<NativeHotkeyPhase, "ready">): void {
    if (phase === "pressed") {
      this.pressedAt = this.now();
      if (this.handsFreeLocked) return;
      if (this.pendingRelease) {
        this.clearTimer?.(this.pendingRelease);
        this.pendingRelease = null;
        this.handsFreeLocked = true;
        this.emit("hands-free-locked");
        return;
      }
      this.emit("pressed");
      return;
    }

    if (phase === "hands-free-toggle") {
      this.cancelPendingRelease();
      if (this.handsFreeLocked) {
        this.handsFreeLocked = false;
        this.suppressNextRelease = true;
        this.emit("hands-free-stop");
      } else {
        this.handsFreeLocked = true;
        this.emit("hands-free-locked");
      }
      return;
    }

    const heldFor = this.pressedAt === null ? Number.POSITIVE_INFINITY : this.now() - this.pressedAt;
    this.pressedAt = null;
    if (this.suppressNextRelease) {
      this.suppressNextRelease = false;
      return;
    }
    if (this.handsFreeLocked) return;
    if (heldFor >= this.quickTapMilliseconds) {
      this.emit("released");
      return;
    }

    this.cancelPendingRelease();
    this.pendingRelease = this.setTimer?.(() => {
      this.pendingRelease = null;
      this.emit("released");
    }, this.doubleTapWindowMilliseconds) ?? null;
  }

  reset(): void {
    this.cancelPendingRelease();
    this.pressedAt = null;
    this.handsFreeLocked = false;
    this.suppressNextRelease = false;
  }

  isLocked(): boolean {
    return this.handsFreeLocked;
  }

  private cancelPendingRelease(): void {
    if (!this.pendingRelease) return;
    this.clearTimer?.(this.pendingRelease);
    this.pendingRelease = null;
  }
}

export function normalizeDictationText(text: string): string {
  return text.trim();
}

export interface FlowBarRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const BOTTOM_FLOW_BAR_SIZE = { width: 184, height: 40 } as const;
export const SIDE_FLOW_BAR_SIZE = { width: 60, height: 156 } as const;
export const BOTTOM_FLOW_BAR_IDLE_SIZE = { width: 48, height: 34 } as const;
export const SIDE_FLOW_BAR_IDLE_SIZE = { width: 34, height: 64 } as const;
const FLOW_BAR_EDGE_INSET = 24;
const FLOW_BAR_IDLE_EDGE_INSET = 10;

/** Pick the supported edge closest to the center of a dropped Flow Bar. */
export function nearestFlowBarDock(
  bounds: FlowBarRectangle,
  workArea: FlowBarRectangle,
): DictationFlowBarDock {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const distances: Array<[DictationFlowBarDock, number]> = [
    ["left", Math.abs(centerX - workArea.x)],
    ["right", Math.abs(workArea.x + workArea.width - centerX)],
    ["bottom", Math.abs(workArea.y + workArea.height - centerY)],
  ];
  distances.sort((left, right) => left[1] - right[1]);
  return distances[0][0];
}

/** Exact work-area-safe bounds used after a Flow Bar is dropped or restored. */
export function flowBarBounds(
  dock: DictationFlowBarDock,
  workArea: FlowBarRectangle,
  compact = false,
): FlowBarRectangle {
  const preferred =
    dock === "bottom"
      ? compact
        ? BOTTOM_FLOW_BAR_IDLE_SIZE
        : BOTTOM_FLOW_BAR_SIZE
      : compact
        ? SIDE_FLOW_BAR_IDLE_SIZE
        : SIDE_FLOW_BAR_SIZE;
  const edgeInset = compact ? FLOW_BAR_IDLE_EDGE_INSET : FLOW_BAR_EDGE_INSET;
  const width = Math.min(preferred.width, Math.max(1, workArea.width - edgeInset * 2));
  const height = Math.min(
    preferred.height,
    Math.max(1, workArea.height - edgeInset * 2),
  );

  if (dock === "bottom") {
    return {
      width,
      height,
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + workArea.height - height - edgeInset),
    };
  }

  return {
    width,
    height,
    x:
      dock === "left"
        ? Math.round(workArea.x + edgeInset)
        : Math.round(workArea.x + workArea.width - width - edgeInset),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
}
