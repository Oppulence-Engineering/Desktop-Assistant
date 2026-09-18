"use client";

import "client-only";

import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { z } from "zod";
import { FloppyDisk, LockSimple } from "@/lib/icons";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { CardDescription } from "@oppulence/ui/components/card";
import { Skeleton } from "@oppulence/ui/components/skeleton";
import { Spinner } from "@oppulence/ui/components/spinner";
import { cn } from "@oppulence/ui/lib/utils";
import { useAuthSession } from "@/components/auth-gate";
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
import { Message, MessageContent } from "@/components/ai-elements/message-shell";
import {
  useChatRouteState,
  useDashboardChatController,
} from "@/components/features/dashboard/chat-route-provider/chat-route-provider";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { useProductRouteState } from "@/hooks/use-product-route-state";
import type { AgentHistoryItem } from "@/lib/agent-history";
import type { RevenueTab, SettingsSection, WorkflowFocus } from "@/lib/product-navigation";
import { getImpact } from "@/lib/revenue";
import type { RevenueImpact } from "@/types/revenue";

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
const AgentConfigurationForm = dynamic(() =>
  import("@/components/agents/agent-configuration-form").then(
    (module) => module.AgentConfigurationForm,
  ),
);
const JsonEditor = dynamic(() =>
  import("@/components/json-editor").then((module) => module.JsonEditor),
);
const MarkdownViewer = dynamic(() =>
  import("@/components/markdown-viewer").then((module) => module.MarkdownViewer),
);
const TiptapMarkdownEditor = dynamic(() =>
  import("@/components/tiptap-markdown-editor").then((module) => module.TiptapMarkdownEditor),
);
const HomeAgentSurface = dynamic(() =>
  import("@/components/features/dashboard/home-agent-surface/home-agent-surface").then(
    (module) => module.HomeAgentSurface,
  ),
);
const MessageResponse = dynamic(() =>
  import("@/components/ai-elements/message").then((module) => module.MessageResponse),
);
const Reasoning = dynamic(() =>
  import("@/components/ai-elements/reasoning").then((module) => module.Reasoning),
);
const ReasoningContent = dynamic(() =>
  import("@/components/ai-elements/reasoning").then((module) => module.ReasoningContent),
);
const ReasoningTrigger = dynamic(() =>
  import("@/components/ai-elements/reasoning").then((module) => module.ReasoningTrigger),
);

type ToolCall = Extract<AgentHistoryItem, { type: "tool" }>;

const ScalarToolOutputSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const HOME_STATS: {
  tab: RevenueTab;
  label: string;
  read: (impact: RevenueImpact) => number;
}[] = [
  {
    tab: "commitments",
    label: "commitments",
    read: (impact) => impact.overdueCommitments,
  },
  { tab: "queue", label: "recovery", read: (impact) => impact.open },
  {
    tab: "relationships",
    label: "at risk",
    read: (impact) => impact.atRiskRelationships,
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
    <footer
      aria-label="Workspace pulse"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-0 text-[12px] text-[var(--text-muted)]"
    >
      {HOME_STATS.map((stat, index) => (
        <span className="inline-flex items-center gap-3" key={stat.tab}>
          {index > 0 ? (
            <span aria-hidden className="text-[var(--border)]">
              ·
            </span>
          ) : null}
          <button
            className="inline-flex items-baseline gap-1.5 font-normal transition-colors hover:text-[var(--text-secondary)]"
            onClick={() => onOpenTab(stat.tab)}
            type="button"
          >
            <span className="font-mono tabular-nums text-[var(--text-secondary)]">
              {impact ? (
                stat.read(impact)
              ) : failed ? (
                "—"
              ) : (
                <Skeleton className="inline-block h-3 w-4" />
              )}
            </span>
            <span>{stat.label}</span>
          </button>
        </span>
      ))}
    </footer>
  );
}

export function RevenueDashboardRoute() {
  const { openRevenueTab, openSettings, revenueTab } = useProductRouteState();
  return (
    <div className="flex-1 overflow-hidden" data-slot="dashboard-route-content">
      <RevenuePanel
        onOpenConnectors={() => openSettings("connections")}
        onTabChange={openRevenueTab}
        tab={revenueTab}
      />
    </div>
  );
}

export type SettingsDashboardRouteProps = {
  section: SettingsSection;
};

export function SettingsDashboardRoute({ section }: SettingsDashboardRouteProps) {
  const session = useAuthSession();
  const { openSettings } = useProductRouteState();
  return <SettingsView onNavigate={openSettings} section={section} session={session} />;
}

export function ReportDashboardRoute() {
  return (
    <div className="flex-1 overflow-y-auto" data-slot="dashboard-route-content">
      <OpenPromisesReportClient />
    </div>
  );
}

export function AgentsDashboardRoute() {
  const chat = useDashboardChatController();
  return (
    <AgentsView
      onAgentsChanged={chat.onAgentsChanged}
      onOpenDefinition={chat.onOpenAgent}
      onUseAgent={chat.onUseAgent}
    />
  );
}

export type WorkflowsDashboardRouteProps = {
  focus: WorkflowFocus;
};

export function WorkflowsDashboardRoute({ focus }: WorkflowsDashboardRouteProps) {
  const { selectedResource: resource } = useDashboardChatController();
  const isTaskResource = resource?.kind === "task" || resource?.kind === "taskrun";
  return (
    <CloudWorkflowsView
      key={isTaskResource ? `${focus}:${resource.name}` : focus}
      focus={focus}
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
  const chat = useChatRouteState();
  const session = useAuthSession();
  const homeUserName = session.user.email || session.user.workosUserId || undefined;
  return (
    <div
      className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pb-0 md:flex-row"
      data-slot="dashboard-route-content"
    >
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {chat.processing ? (
          <Badge
            className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 gap-2 px-3 py-1.5 text-xs font-medium text-primary/70 shadow-sm"
            variant="secondary"
          >
            <Spinner className="size-3.5" />
            Working…
          </Badge>
        ) : null}
        <Conversation className="min-h-0 flex-1 overflow-y-auto">
          {!chat.empty ? (
            <div className="pointer-events-none sticky bottom-0 z-10 h-16 bg-gradient-to-t from-background via-background/80 to-transparent" />
          ) : null}
          <ConversationContent
            className={cn(
              "!flex !flex-col !items-center !gap-8 !p-4 pt-4",
              chat.empty ? "!pb-4" : "!pb-32",
            )}
          >
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
                    <Alert className="border-amber-500/30 bg-amber-500/5" key={item.id}>
                      <AlertTitle className="text-sm text-primary">
                        Approval required: {item.name}
                      </AlertTitle>
                      <AlertDescription className="text-xs text-primary/55">
                        Trust tier: {item.trustTier.replaceAll("_", " ")}
                      </AlertDescription>
                      <div className="col-start-2 mt-3">
                        <ToolInput input={item.input} />
                      </div>
                      {item.status === "pending" ? (
                        <div className="col-start-2 mt-3 flex gap-2">
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
                        <AlertDescription className="col-start-2 mt-3 text-xs capitalize text-primary/60">
                          {item.status === "resolving" ? "Submitting decision…" : item.status}
                        </AlertDescription>
                      )}
                    </Alert>
                  );
                }
                return null;
              })}
            </div>
          </ConversationContent>
        </Conversation>

        {chat.empty ? (
          <div className="absolute inset-0 overflow-y-auto">
            <HomeAgentSurface
              activeAgent={chat.activeAgent}
              onSelectPrompt={chat.onSelectPrompt}
              promptInput={chat.promptInput}
              signalPanel={<HomeOverview onOpenTab={chat.onOpenRevenueTab} />}
              userName={homeUserName}
              workspace={chat.workspace}
            />
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
                    <Badge className="ml-2 gap-1 font-normal" variant="outline">
                      <LockSimple className="h-3 w-3" /> Read-only
                    </Badge>
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
                      <Spinner className="size-4" />
                    ) : (
                      <FloppyDisk className="h-4 w-4" />
                    )}
                    {chat.artifact.text !== chat.artifact.original ? "Save changes" : "Saved"}
                  </ArtifactAction>
                ) : null}
                <ArtifactClose onClick={chat.artifact.onClose} />
              </ArtifactActions>
            </ArtifactHeader>
            <ArtifactContent className="bg-muted/30">
              {chat.artifact.loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" /> Loading
                </div>
              ) : chat.artifact.error ? (
                <Alert variant="destructive">
                  <AlertDescription className="whitespace-pre-wrap break-words">
                    {chat.artifact.error}
                  </AlertDescription>
                </Alert>
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
                    <CardDescription className="text-xs text-muted-foreground">
                      {chat.artifact.resource.kind === "agent"
                        ? "This managed agent can be viewed here but cannot be changed from the workspace."
                        : "Runs are read-only; use the API to replay or inspect in detail."}
                    </CardDescription>
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
