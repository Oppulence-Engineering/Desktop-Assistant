import { ArrowUpRight, Workflow, Mail, MessageSquare, Sparkles, ScanSearch } from "@/lib/icons";

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";

export interface ChatEmptyStateRun {
  id: string;
  title?: string;
  createdAt: string;
}

interface ChatEmptyStateProps {
  recentRuns?: ChatEmptyStateRun[];
  onSelectRun?: (runId: string) => void;
  onOpenChatHistory?: () => void;
  /** Fill the composer with a starter prompt (does not submit). */
  onPickPrompt: (prompt: string) => void;
  /** Use a wider column — for the full-screen chat where the narrow column looks cramped. */
  wide?: boolean;
  context?: ChatWorkContext;
}

export interface ChatWorkContext {
  type:
    | "relationship"
    | "email"
    | "meeting"
    | "knowledge"
    | "workspace"
    | "task"
    | "home"
    | "browser";
  label: string;
  detail?: string;
  hasSelection?: boolean;
}

const SUGGESTED_ACTIONS: {
  icon: typeof Mail;
  title: string;
  sub: string;
  prompt: string;
}[] = [
  {
    icon: Sparkles,
    title: "Review account attention",
    sub: "find the next relationship to act on",
    prompt: "Which customer relationships need attention now? Explain the evidence and urgency.",
  },
  {
    icon: ScanSearch,
    title: "Explain what changed",
    sub: "with source-linked relationship evidence",
    prompt: "What changed in my customer relationships recently? Cite the supporting evidence.",
  },
  {
    icon: Mail,
    title: "Draft the next action",
    sub: "keep it reviewable and approval-gated",
    prompt:
      "Draft the highest-leverage next action for the account that needs attention. Do not send it.",
  },
];

function suggestedActionsForContext(context?: ChatWorkContext): typeof SUGGESTED_ACTIONS {
  if (!context) return SUGGESTED_ACTIONS;
  const subject = context.label;
  switch (context.type) {
    case "relationship":
      return [
        {
          icon: Sparkles,
          title: "Explain what changed",
          sub: "with evidence from this relationship",
          prompt: `Explain what changed for ${subject}. Cite the supporting evidence and call out uncertainty.`,
        },
        {
          icon: Workflow,
          title: "Recommend the next action",
          sub: "keep execution approval-gated",
          prompt: `Recommend the highest-leverage next action for ${subject}. Explain why and draft it without sending.`,
        },
        {
          icon: ScanSearch,
          title: "Find hidden risk",
          sub: "check commitments, people, and stale evidence",
          prompt: `Review ${subject} for risks, overdue commitments, missing stakeholders, and stale evidence.`,
        },
      ];
    case "email":
      return [
        {
          icon: Mail,
          title: "Triage this thread",
          sub: "summarize intent and urgency",
          prompt: `Triage ${subject}: summarize the request, urgency, commitments, and unresolved questions.`,
        },
        {
          icon: Sparkles,
          title: "Draft a reply",
          sub: "grounded in the open thread",
          prompt: `Draft a concise reply for ${subject}. Do not send it.`,
        },
        {
          icon: ScanSearch,
          title: "Find related context",
          sub: "across notes and relationship evidence",
          prompt: `Find context related to ${subject} and explain what should influence the reply.`,
        },
      ];
    case "meeting":
      return [
        {
          icon: Sparkles,
          title: "Prepare for the meeting",
          sub: "brief me on people, risks, and commitments",
          prompt: `Prepare me for ${subject}. Include participants, open commitments, risks, and questions to ask.`,
        },
        {
          icon: Workflow,
          title: "Build an agenda",
          sub: "focus on decisions and next steps",
          prompt: `Create a decision-oriented agenda for ${subject}.`,
        },
        {
          icon: ScanSearch,
          title: "Review prior evidence",
          sub: "surface relevant notes and conversations",
          prompt: `Find the most relevant prior evidence for ${subject} and cite its source.`,
        },
      ];
    case "knowledge":
    case "workspace":
      return [
        {
          icon: Sparkles,
          title: "Summarize this context",
          sub: "preserve decisions and open questions",
          prompt: `Summarize ${subject}, including decisions, commitments, risks, and unresolved questions.`,
        },
        {
          icon: ScanSearch,
          title: "Find related knowledge",
          sub: "connect people, accounts, and evidence",
          prompt: `Find knowledge related to ${subject} and explain the strongest connections.`,
        },
        {
          icon: Workflow,
          title: "Turn this into a plan",
          sub: "create clear next actions",
          prompt: `Turn ${subject} into a prioritized plan with owners, dependencies, and next actions.`,
        },
      ];
    case "task":
      if (context.hasSelection === false) {
        return [
          {
            icon: Workflow,
            title: "Design a recurring task",
            sub: "define its trigger, outcome, and approvals",
            prompt:
              "Help me design a recurring background task. Ask what should trigger it, what outcome I need, and which actions require approval.",
          },
          {
            icon: ScanSearch,
            title: "See automation examples",
            sub: "find useful patterns for my work",
            prompt:
              "Show me practical background-task examples for relationship work, including their triggers and safeguards.",
          },
          {
            icon: Sparkles,
            title: "Explain approval safety",
            sub: "understand drafts, actions, and review gates",
            prompt:
              "Explain how background tasks keep external actions approval-gated and what I can safely automate.",
          },
        ];
      }
      return [
        {
          icon: Sparkles,
          title: "Explain this automation",
          sub: "inputs, actions, and safeguards",
          prompt: `Explain how ${subject} works, including inputs, outputs, permissions, and failure modes.`,
        },
        {
          icon: ScanSearch,
          title: "Review recent runs",
          sub: "find failures and unexpected behavior",
          prompt: `Review recent runs for ${subject} and identify failures, drift, or unsafe behavior.`,
        },
        {
          icon: Workflow,
          title: "Improve this task",
          sub: "make it clearer and more reliable",
          prompt: `Suggest improvements to ${subject}. Keep external actions approval-gated.`,
        },
      ];
    default:
      return SUGGESTED_ACTIONS;
  }
}

/**
 * Empty-state body for the chat surface: greeting, recent chats, and starter
 * action cards. Shown in both the side-pane copilot and full-screen chat.
 */
export function ChatEmptyState({
  recentRuns = [],
  onSelectRun,
  onOpenChatHistory,
  onPickPrompt,
  wide = false,
  context,
}: ChatEmptyStateProps) {
  const suggestedActions = suggestedActionsForContext(context);
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-2 py-6",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-none border border-border bg-background text-foreground">
          <Sparkles className="size-[17px]" />
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight">What are we working on?</div>
          <div className="text-xs text-muted-foreground">
            Ask anything, or pick up where you left off.
          </div>
        </div>
      </div>

      {recentRuns.length > 0 && (
        <div>
          <div className="flex items-center px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">Recent chats</span>
            {onOpenChatHistory && (
              <button
                type="button"
                onClick={onOpenChatHistory}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium normal-case tracking-normal text-primary hover:underline"
              >
                View all
                <ArrowUpRight className="size-3" />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {recentRuns.slice(0, 4).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelectRun?.(run.id)}
                className="flex items-center gap-2.5 rounded-none px-2.5 py-2 text-left hover:bg-accent"
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {run.title || "(Untitled chat)"}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatRelativeTime(run.createdAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {recentRuns.length > 0 ? "Or start fresh" : "Get started"}
        </div>
        <div className="flex flex-col gap-2">
          {suggestedActions.map((action) => (
            <button
              key={action.title}
              type="button"
              onClick={() => onPickPrompt(action.prompt)}
              className="flex items-start gap-2.5 rounded-none border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent"
            >
              <action.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.8px] font-medium">{action.title}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">{action.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
