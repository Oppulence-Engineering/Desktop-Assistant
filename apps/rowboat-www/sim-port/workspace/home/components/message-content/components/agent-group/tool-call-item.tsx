import type { ReactNode } from "react";
import type { ActivityStatusProps } from "@/components/sim/activity-status";
import type { ToolCallData, ToolCallStatus } from "@/sim-port/workspace/home/types";

export interface ToolCallItemProps {
  toolName: string;
  displayTitle: string;
  activityDescription?: string;
  status: ToolCallStatus;
  params?: Record<string, unknown>;
  result?: ToolCallData["result"];
  streamingArgs?: string;
  toolCallId?: string;
  startedAt?: number;
  renderStatus?: (status: ToolActivityPresentation) => ReactNode;
}

export interface ToolActivityPresentation extends ActivityStatusProps {
  activeLabel: string;
}

export function CircleStop({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.25" />
      <rect x="6" y="6" width="4" height="4" rx="0.5" fill="currentColor" />
    </svg>
  );
}
