/** Landing-preview subset of Sim workspace home types (hero chat loop). */

export const ToolCallStatus = {
  executing: "executing",
  awaiting_approval: "awaiting_approval",
  success: "success",
  error: "error",
  cancelled: "cancelled",
  skipped: "skipped",
  rejected: "rejected",
  interrupted: "interrupted",
} as const;

export type ToolCallStatus = (typeof ToolCallStatus)[keyof typeof ToolCallStatus];

interface ToolCallResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface ToolCallData {
  id: string;
  toolName: string;
  displayTitle: string;
  activityDescription?: string;
  status: ToolCallStatus;
  params?: Record<string, unknown>;
  result?: ToolCallResult;
  streamingArgs?: string;
  startedAt?: number;
}

export type QuestionType = "single_select" | "multi_select";

export interface QuestionOption {
  id: string;
  label: string;
}

export interface QuestionItem {
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
}
