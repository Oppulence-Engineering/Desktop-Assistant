"use client";

import "client-only";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { z } from "zod";
import {
  AddressBook,
  ArrowSquareOut,
  BookOpen,
  CheckSquare,
  CircleNotch,
  FileText,
  FloppyDisk,
  LockSimple,
  Question,
  Tray,
} from "@phosphor-icons/react";

import { Button } from "@oppulence/ui/components/button";
import { cn } from "@oppulence/ui/lib/utils";
import { AgentConfigurationForm } from "@/components/agents/agent-configuration-form";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { JsonEditor } from "@/components/json-editor";
import { MarkdownViewer } from "@/components/markdown-viewer";
import { TiptapMarkdownEditor } from "@/components/tiptap-markdown-editor";
import type { AgentHistoryItem } from "@/lib/agent-history";
import { REVENUE_TAB_LABELS, type RevenueTab } from "@/lib/product-navigation";
import { getImpact } from "@/lib/revenue";
import type { RevenueImpact } from "@/types/revenue";

import { useDashboardRouteContext } from "./dashboard-route-context";

const AgentsView = dynamic(() =>
  import("@/components/agents/agents-view").then((module) => module.AgentsView),
);
const CloudWorkflowsView = dynamic(() =>
  import("@/components/workflows/cloud-workflows-view").then((module) => module.CloudWorkflowsView),
);
const RevenuePanel = dynamic(() =>
  import("@/components/revenue-panel").then((module) => module.RevenuePanel),
);
const SettingsView = dynamic(() =>
  import("@/components/app-settings").then((module) => module.SettingsView),
);
const OpenPromisesReportClient = dynamic(() =>
  import("@/app/(product)/app/report/report-client").then(
    (module) => module.OpenPromisesReportClient,
  ),
);

type ToolCall = Extract<AgentHistoryItem, { type: "tool" }>;

const ScalarToolOutputSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const HOME_STATS: {
  tab: RevenueTab;
  icon: typeof CheckSquare;
  caption: string;
  read: (impact: RevenueImpact) => number;
}[] = [
  {
    tab: "commitments",
    icon: CheckSquare,
    caption: "Overdue commitments",
    read: (impact) => impact.overdueCommitments,
  },
  { tab: "queue", icon: Tray, caption: "Open actions", read: (impact) => impact.open },
  {
    tab: "relationships",
    icon: AddressBook,
    caption: "Accounts at risk",
    read: (impact) => impact.atRiskRelationships,
  },
];

const HOME_LINKS = [
  {
    href: "/app/report",
    icon: FileText,
    label: "Open promises",
    detail: "The commitments with no evidence of fulfilment",
    external: false,
  },
  {
    href: "/api/reference",
    icon: BookOpen,
    label: "API",
    detail: "Drive the workspace programmatically",
    external: true,
  },
  {
    href: "/blog",
    icon: Question,
    label: "Help",
    detail: "Guides, changes, and how the scoring works",
    external: true,
  },
];

export type DashboardRouteContentProps = ComponentPropsWithoutRef<"section">;

export function DashboardRouteContent({ className, ...props }: DashboardRouteContentProps) {
  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-slot="dashboard-route-content"
      {...props}
    />
  );
}

function renderToolOutput(value: unknown): string {
  const scalar = ScalarToolOutputSchema.safeParse(value);
  if (scalar.success) return String(scalar.data ?? "");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Tool returned an unreadable result.";
  }
}

function HomeOverview({ onOpenTab }: { onOpenTab: (tab: RevenueTab) => void }) {
  const [impact, setImpact] = useState<RevenueImpact | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getImpact()
      .then((data) => {
        if (!cancelled) setImpact(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section className="mt-10 grid gap-3 sm:grid-cols-3">
        {HOME_STATS.map((stat) => (
          <button
            className="border border-border text-left transition-colors hover:bg-background-100/70"
            key={stat.tab}
            onClick={() => onOpenTab(stat.tab)}
            type="button"
          >
            <span className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-[13px] font-medium text-primary">
              <stat.icon className="size-4 text-primary/45" />
              {REVENUE_TAB_LABELS[stat.tab]}
            </span>
            <span className="block px-3 pb-3 pt-4">
              <span className="block text-3xl font-semibold tabular-nums text-primary">
                {impact ? (
                  stat.read(impact)
                ) : failed ? (
                  "—"
                ) : (
                  <span className="inline-block h-7 w-10 animate-pulse bg-background-200 align-middle" />
                )}
              </span>
              <span className="mt-1 block text-[12px] text-primary/45">{stat.caption}</span>
            </span>
          </button>
        ))}
      </section>
      <section className="mt-10">
        <h2 className="mb-3 text-[13px] font-medium text-primary">Explore</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {HOME_LINKS.map((link) => (
            <Link
              className="block"
              href={link.href}
              key={link.href}
              {...(link.external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
                <link.icon className="size-4 text-primary/45" />
                {link.label}
                {link.external ? <ArrowSquareOut className="size-3 text-primary/35" /> : null}
              </span>
              <span className="mt-1 block text-[12px] text-primary/45">{link.detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

export function RevenueDashboardRoute() {
  const { revenue } = useDashboardRouteContext();
  return (
    <div className="flex-1 overflow-hidden" data-slot="dashboard-route-content">
      <RevenuePanel {...revenue} />
    </div>
  );
}

export function SettingsDashboardRoute() {
  const { settings } = useDashboardRouteContext();
  return <SettingsView {...settings} />;
}

export function ReportDashboardRoute() {
  return (
    <div className="flex-1 overflow-y-auto" data-slot="dashboard-route-content">
      <OpenPromisesReportClient />
    </div>
  );
}

export function AgentsDashboardRoute() {
  const { agents } = useDashboardRouteContext();
  return <AgentsView {...agents} />;
}

export function WorkflowsDashboardRoute() {
  const { workflows } = useDashboardRouteContext();
  const resource = workflows.selectedResource;
  const isTaskResource = resource?.kind === "task" || resource?.kind === "taskrun";
  return (
    <CloudWorkflowsView
      key={isTaskResource ? `${workflows.focus}:${resource.name}` : workflows.focus}
      focus={workflows.focus}
      initialRunId={
        resource?.kind === "taskrun" ? resource.name.split("/").slice(1).join("/") : undefined
      }
      initialSlug={
        resource?.kind === "task"
          ? resource.name
          : resource?.kind === "taskrun"
            ? resource.name.split("/")[0]
            : undefined
      }
    />
  );
}

export function ChatDashboardRoute() {
  const { chat } = useDashboardRouteContext();
  return (
    <div
      className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pb-0 md:flex-row"
      data-slot="dashboard-route-content"
    >
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {chat.processing ? (
          <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-primary/70 shadow-sm">
            <CircleNotch className="h-3.5 w-3.5 animate-spin" />
            <span>Working…</span>
          </div>
        ) : null}
        <Conversation className="min-h-0 flex-1 overflow-y-auto">
          {!chat.empty ? (
            <div className="pointer-events-none sticky bottom-0 z-10 h-16 bg-gradient-to-t from-background via-background/80 to-transparent" />
          ) : null}
          <ConversationContent className="!flex !flex-col !items-center !gap-8 !p-4 pb-32 pt-4">
            <div className="mx-auto w-full max-w-3xl space-y-4">
              {chat.conversation.map((item) => {
                if (item.type === "message") {
                  return (
                    <Message from={item.role} key={item.id}>
                      <MessageContent>
                        <MessageResponse>{item.content}</MessageResponse>
                      </MessageContent>
                    </Message>
                  );
                }
                if (item.type === "tool") {
                  const states: Record<
                    ToolCall["status"],
                    "input-streaming" | "input-available" | "output-available" | "output-error"
                  > = {
                    pending: "input-streaming",
                    running: "input-available",
                    completed: "output-available",
                    error: "output-error",
                  };
                  return (
                    <div className="mb-2" key={item.id}>
                      <Tool>
                        <ToolHeader
                          state={states[item.status]}
                          title={item.name}
                          type="tool-call"
                        />
                        <ToolContent>
                          <ToolInput input={item.input} />
                          {item.result != null ? (
                            <ToolOutput
                              errorText={undefined}
                              output={renderToolOutput(item.result)}
                            />
                          ) : null}
                        </ToolContent>
                      </Tool>
                    </div>
                  );
                }
                if (item.type === "reasoning") {
                  return (
                    <div className="mb-2" key={item.id}>
                      <Reasoning isStreaming={item.isStreaming}>
                        <ReasoningTrigger />
                        <ReasoningContent>{item.content}</ReasoningContent>
                      </Reasoning>
                    </div>
                  );
                }
                if (item.type === "approval") {
                  return (
                    <div
                      className="rounded-none border border-amber-500/30 bg-amber-500/5 p-4"
                      key={item.id}
                    >
                      <p className="text-sm font-medium text-primary">
                        Approval required: {item.name}
                      </p>
                      <p className="mt-1 text-xs text-primary/55">
                        Trust tier: {item.trustTier.replaceAll("_", " ")}
                      </p>
                      <div className="mt-3">
                        <ToolInput input={item.input} />
                      </div>
                      {item.status === "pending" ? (
                        <div className="mt-3 flex gap-2">
                          <Button
                            onClick={() => void chat.onResolveApproval(item, "granted")}
                            size="sm"
                          >
                            Approve
                          </Button>
                          <Button
                            onClick={() => void chat.onResolveApproval(item, "denied")}
                            size="sm"
                            variant="outline"
                          >
                            Deny
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-3 text-xs capitalize text-primary/60">
                          {item.status === "resolving" ? "Submitting decision…" : item.status}
                        </p>
                      )}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </ConversationContent>
        </Conversation>

        {chat.empty ? (
          <div className="absolute inset-0 overflow-y-auto px-4">
            <div className="mx-auto w-full max-w-3xl pb-12 pt-20">
              <p className="text-[13px] text-primary/50">👋 Welcome back</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                {chat.workspace}
              </h1>
              <p className="mt-1 text-[13px] text-primary/50">
                Find the promises, relationship risks, and next steps that need attention.
              </p>
              <div className="mt-5">{chat.promptInput}</div>
              <HomeOverview onOpenTab={chat.onOpenRevenueTab} />
            </div>
          </div>
        ) : (
          <div className="w-full px-4 pb-5 pt-2">
            <div className="mx-auto w-full max-w-3xl">{chat.promptInput}</div>
          </div>
        )}
      </div>

      {chat.artifact ? (
        <div className="flex min-h-[260px] w-full flex-col py-5 md:min-h-0 md:w-[70%] md:max-w-4xl md:shrink-0">
          <Artifact className="h-full min-h-0 flex-1">
            <ArtifactHeader>
              <div className="flex flex-col">
                <ArtifactTitle className="truncate">{chat.artifact.title}</ArtifactTitle>
                <ArtifactDescription className="text-xs">
                  {chat.artifact.subtitle || chat.artifact.resource.kind}
                  {chat.artifact.readOnly ? (
                    <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                      <LockSimple className="h-3 w-3" /> Read-only
                    </span>
                  ) : null}
                </ArtifactDescription>
              </div>
              <ArtifactActions>
                {!chat.artifact.readOnly ? (
                  <ArtifactAction
                    className="w-auto gap-1.5 px-3"
                    disabled={
                      chat.artifact.text === chat.artifact.original || chat.artifact.loading
                    }
                    onClick={chat.artifact.onSave}
                    tooltip={
                      chat.artifact.text !== chat.artifact.original ? "Save changes" : "Saved"
                    }
                  >
                    {chat.artifact.loading ? (
                      <CircleNotch className="h-4 w-4 animate-spin" />
                    ) : (
                      <FloppyDisk className="h-4 w-4" />
                    )}
                    <span>
                      {chat.artifact.text !== chat.artifact.original ? "Save changes" : "Saved"}
                    </span>
                  </ArtifactAction>
                ) : null}
                <ArtifactClose onClick={chat.artifact.onClose} />
              </ArtifactActions>
            </ArtifactHeader>
            <ArtifactContent className="bg-muted/30">
              {chat.artifact.loading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <CircleNotch className="mr-2 h-4 w-4 animate-spin" /> Loading
                </div>
              ) : chat.artifact.error ? (
                <div className="whitespace-pre-wrap break-words text-sm text-red-500">
                  {chat.artifact.error}
                </div>
              ) : (
                <div className="flex h-full flex-col gap-2">
                  {chat.artifact.resource.kind === "agent" && chat.artifact.fileType === "json" ? (
                    <AgentConfigurationForm
                      agentSlugs={chat.artifact.agentOptions}
                      content={chat.artifact.text}
                      onChange={chat.artifact.onChange}
                      readOnly={chat.artifact.readOnly}
                    />
                  ) : chat.artifact.readOnly ? (
                    chat.artifact.fileType === "markdown" ? (
                      <MarkdownViewer content={chat.artifact.text} />
                    ) : (
                      <pre className="h-full min-h-[240px] max-h-[70vh] w-full overflow-auto whitespace-pre-wrap rounded-none border bg-background p-4 font-mono text-sm leading-relaxed text-foreground">
                        {chat.artifact.text}
                      </pre>
                    )
                  ) : chat.artifact.fileType === "markdown" ? (
                    <TiptapMarkdownEditor
                      content={chat.artifact.text}
                      onChange={chat.artifact.onChange}
                      placeholder="Start writing your markdown..."
                      readOnly={false}
                    />
                  ) : (
                    <JsonEditor
                      content={chat.artifact.text}
                      onChange={chat.artifact.onChange}
                      readOnly={false}
                    />
                  )}
                  {chat.artifact.readOnly ? (
                    <p className="text-xs text-muted-foreground">
                      {chat.artifact.resource.kind === "agent"
                        ? "This managed agent can be viewed here but cannot be changed from the workspace."
                        : "Runs are read-only; use the API to replay or inspect in detail."}
                    </p>
                  ) : null}
                </div>
              )}
            </ArtifactContent>
          </Artifact>
        </div>
      ) : null}
    </div>
  );
}
