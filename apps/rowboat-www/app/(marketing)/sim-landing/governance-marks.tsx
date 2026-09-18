import type { ReactNode } from "react";

/**
 * Outline governance marks — same stroke geometry as Sim's workspace-control icons
 * (`apps/sim/app/(landing)/components/security/icons.tsx`). Thin strokes read lighter
 * than filled Phosphor icons at 56px and keep the grid feeling zoomed out.
 */
export interface GovernanceMarkProps {
  className?: string;
}

const FEATURE_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.55,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Shift viewBox so the mark's left stroke edge aligns with cell text. */
function flushLeftBox(geometryLeft: number): string {
  return `${geometryLeft - FEATURE_STROKE.strokeWidth / 2} 0 64 64`;
}

interface MarkSvgProps {
  className?: string;
  viewBox: string;
  children: ReactNode;
}

function MarkSvg({ className, viewBox, children }: MarkSvgProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      overflow="visible"
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function ApprovalMark({ className }: GovernanceMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(22)}>
      <rect height="24" rx="4" width="20" x="22" y="30" {...FEATURE_STROKE} />
      <path d="M26 30v-6a6 6 0 0 1 12 0v6" {...FEATURE_STROKE} />
    </MarkSvg>
  );
}

export function SourceMark({ className }: GovernanceMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(18 - 2.2)}>
      <path d="M18 16v32" {...FEATURE_STROKE} />
      <circle cx="18" cy="22" r="2.2" {...FEATURE_STROKE} />
      <circle cx="18" cy="32" r="2.2" {...FEATURE_STROKE} />
      <circle cx="18" cy="42" r="2.2" {...FEATURE_STROKE} />
      <path d="M24 22h22M24 32h16M24 42h20" {...FEATURE_STROKE} />
    </MarkSvg>
  );
}

export function LocalMark({ className }: GovernanceMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(14)}>
      <rect height="14" rx="3" width="36" x="14" y="16" {...FEATURE_STROKE} />
      <rect height="14" rx="3" width="36" x="14" y="34" {...FEATURE_STROKE} />
      <circle cx="20" cy="23" r="1.5" {...FEATURE_STROKE} />
      <circle cx="20" cy="41" r="1.5" {...FEATURE_STROKE} />
      <path d="M28 23h16M28 41h16" {...FEATURE_STROKE} />
    </MarkSvg>
  );
}

export function SyncMark({ className }: GovernanceMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(16)}>
      <path d="M44 28a12 12 0 0 0-20.4-8.5" {...FEATURE_STROKE} />
      <path d="M20 36l3.5-3.5L20 29" {...FEATURE_STROKE} />
      <path d="M20 36a12 12 0 0 0 20.4 8.5" {...FEATURE_STROKE} />
      <path d="M44 28l-3.5 3.5L44 35" {...FEATURE_STROKE} />
    </MarkSvg>
  );
}

export function KeysMark({ className }: GovernanceMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(20)}>
      <circle cx="28" cy="24" r="8" {...FEATURE_STROKE} />
      <path d="M34 30l10 10M40 36l4 4" {...FEATURE_STROKE} />
      <path d="M38 32v4M42 36v4" {...FEATURE_STROKE} />
    </MarkSvg>
  );
}

export function SelfHostMark({ className }: GovernanceMarkProps) {
  return (
    <MarkSvg className={className} viewBox={flushLeftBox(16)}>
      <path d="M32 18v8" {...FEATURE_STROKE} />
      <path d="M24 26h16" {...FEATURE_STROKE} />
      <path d="M20 26c0 8 5.4 14 12 14s12-6 12-14" {...FEATURE_STROKE} />
      <path d="M26 40h12" {...FEATURE_STROKE} />
    </MarkSvg>
  );
}
