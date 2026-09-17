"use client";

import {
  AppShellSidebar,
  AppTopBar,
  REVENUE_TAB_LABELS,
  SETTINGS_SECTIONS,
  useWorkspaceLabel,
  ViewBoundary,
} from "@/components/app-shell";
import { AuthGate, useAuthSession } from "@/components/auth-gate";
import { CommandPalette } from "@/components/command-palette";
import {
  DashboardRouteProvider,
  type DashboardRouteContextValue,
} from "@/components/features/dashboard/dashboard-route-content/dashboard-route-context";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputHeader,
} from "@/components/ai-elements/prompt-input";
import { useState, useEffect, useRef, type ReactNode, useCallback, useMemo } from "react";
import { SidebarSimple } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { Label } from "@oppulence/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { useBooleanPref } from "@/lib/console-prefs";
import type { SelectedResource } from "@/lib/dashboard-resource";
import {
  WEB_CHAT_ACCEPT,
  WEB_CHAT_MAX_FILE_BYTES,
  WEB_CHAT_MAX_FILES,
} from "@/lib/chat-attachments";
import { useProductRouteState } from "@/hooks/use-product-route-state";
import { useDashboardArtifact } from "@/hooks/use-dashboard-artifact";
import type { SessionScope } from "@/lib/chat-sessions";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import { useAgentRun } from "@/hooks/use-agent-run";
import { useChatSessions } from "@/hooks/use-chat-sessions";
import type { BrowserSessionResponse } from "@/lib/auth/schemas";

function PageBody({ children }: { children: ReactNode }) {
  const session = useAuthSession();
  const {
    view,
    revenueTab,
    settingsSection,
    workflowFocus,
    navigateTo,
    openRevenueTab,
    openSettings,
    openWorkflows,
  } = useProductRouteState();
  const sessionScope = useMemo<SessionScope>(
    () => ({
      organizationId: session.user.organizationId,
      userId: session.user.id ?? session.user.workosUserId ?? session.user.email ?? "unknown-user",
    }),
    [session.user.email, session.user.id, session.user.organizationId, session.user.workosUserId],
  );
  const shellUser = useMemo(
    () => ({
      name: session.user.email || session.user.workosUserId || "User",
      email: session.user.email || session.user.workosUserId || "",
    }),
    [session.user.email, session.user.workosUserId],
  );
  const workspace = useWorkspaceLabel(shellUser);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const [sidebarOpen, setSidebarOpen] = useBooleanPref("app-sidebar-open", true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { agentOptions, refreshAgents, selectedAgent, setSelectedAgent } = useAgentCatalog();
  const {
    beginOpenRun,
    chatError,
    conversation,
    failOpenRun,
    openRun,
    processing,
    resetRun,
    resolveApproval,
    runId,
    setChatError,
    setText,
    status,
    stopRun,
    submit,
    text,
  } = useAgentRun(selectedAgent);

  const selectPrompt = useCallback(
    (prompt: string) => {
      setText(prompt);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setText],
  );

  const startNewChat = useCallback(() => {
    resetRun();
    setSelectedResource(null);
    navigateTo("chat");
  }, [navigateTo, resetRun]);

  const selectAgent = useCallback(
    (agent: string) => {
      if (agent === selectedAgent) return;
      startNewChat();
      setSelectedAgent(agent);
    },
    [selectedAgent, setSelectedAgent, startNewChat],
  );

  const { openSession: loadSession, sessions } = useChatSessions({
    activeRunId: runId,
    conversation,
    onBeginOpen: beginOpenRun,
    onFailedOpen: failOpenRun,
    onOpen: openRun,
    onSelectAgent: setSelectedAgent,
    scope: sessionScope,
    selectedAgent,
  });

  const openSession = useCallback(
    async (nextRunId: string) => {
      if (nextRunId === runId) {
        navigateTo("chat");
        return;
      }
      navigateTo("chat");
      setSelectedResource(null);
      await loadSession(nextRunId);
    },
    [loadSession, navigateTo, runId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);
  const artifact = useDashboardArtifact(selectedResource);

  const isHomeEmpty = conversation.length === 0;

  const renderPromptInput = () => (
    <div className="space-y-2">
      {chatError ? (
        <p className="text-left text-sm text-destructive" role="alert">
          {chatError}
        </p>
      ) : null}
      <PromptInput
        accept={WEB_CHAT_ACCEPT}
        globalDrop
        maxFiles={WEB_CHAT_MAX_FILES}
        maxFileSize={WEB_CHAT_MAX_FILE_BYTES}
        multiple
        onError={({ message }) => setChatError(message)}
        onSubmit={submit}
      >
        <PromptInputHeader>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            ref={textareaRef}
            onChange={(event) => setText(event.target.value)}
            value={text}
            placeholder={
              isHomeEmpty ? "Name the loose end…" : "Ask about a client, commitment, or next step"
            }
            className={isHomeEmpty ? "min-h-12 max-h-[200px]" : "min-h-[46px] max-h-[200px]"}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments label="Add text file" />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <PromptInputSpeechButton
              aria-label="Dictate message"
              onTranscriptionChange={setText}
              textareaRef={textareaRef}
            />
            <Select value={selectedAgent} onValueChange={selectAgent}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {agentOptions.map((agent) => (
                    <SelectItem key={agent} value={agent}>
                      {agent}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </PromptInputTools>
          <PromptInputSubmit
            aria-label={status === "streaming" ? "Stop response" : "Submit"}
            disabled={status === "submitted"}
            onClick={(event) => {
              if (status !== "streaming") return;
              event.preventDefault();
              void stopRun();
            }}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );

  const routeContext: DashboardRouteContextValue = {
    chat: {
      activeAgent: selectedAgent,
      workspace,
      processing,
      conversation,
      empty: conversation.length === 0,
      promptInput: renderPromptInput(),
      artifact: artifact
        ? {
            ...artifact,
            agentOptions,
            onClose: () => setSelectedResource(null),
          }
        : null,
      onOpenRevenueTab: openRevenueTab,
      onSelectPrompt: selectPrompt,
      onResolveApproval: resolveApproval,
    },
    agents: {
      onAgentsChanged: refreshAgents,
      onOpenDefinition: (slug) => {
        setSelectedResource({ kind: "agent", name: slug });
        navigateTo("chat");
      },
      onUseAgent: (slug) => {
        startNewChat();
        setSelectedAgent(slug);
      },
    },
    revenue: {
      tab: revenueTab,
      onTabChange: openRevenueTab,
      onOpenConnectors: () => openSettings("connections"),
    },
    settings: {
      section: settingsSection,
      session,
      onNavigate: openSettings,
    },
    workflows: {
      focus: workflowFocus,
      selectedResource,
    },
  };

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background-50">
      <CommandPalette
        agents={agentOptions}
        onNavigateChat={() => {
          navigateTo("chat");
          setSelectedResource(null);
        }}
        onNavigateRelationship={() => openRevenueTab("relationships")}
        onNewChat={startNewChat}
        onOpenAgent={(name) => {
          navigateTo("chat");
          setSelectedResource({ kind: "agent", name });
        }}
        onOpenSession={openSession}
        onOpenSettings={openSettings}
        onOpenChange={setPaletteOpen}
        onToggleSidebar={toggleSidebar}
        open={paletteOpen}
        sessions={sessions}
      />
      <AppTopBar
        onAsk={() => setPaletteOpen(true)}
        onOpenPeople={() => {
          openRevenueTab("people");
          setSelectedResource(null);
        }}
      />
      {/* The workspace sits in an inset frame under the top bar; phones use the
          full width, where an inset only costs space. */}
      <div className="min-h-0 w-full flex-1 md:px-2.5 md:pb-2.5">
        <section
          className={`relative flex h-full overflow-clip border-t bg-background ${
            view === "settings" ? "settings-workspace border-0 md:border-0" : "md:border"
          }`}
        >
          <AppShellSidebar
            onCloseSettings={() => navigateTo("chat")}
            onNavigateChat={() => {
              navigateTo("chat");
              setSelectedResource(null);
            }}
            onNavigateReport={() => {
              navigateTo("report");
              setSelectedResource(null);
            }}
            onNavigateRevenue={(tab) => {
              openRevenueTab(tab);
              setSelectedResource(null);
            }}
            onNavigateAgents={() => {
              navigateTo("agents");
              setSelectedResource(null);
            }}
            onNavigateScheduled={() => {
              openWorkflows("scheduled");
              setSelectedResource(null);
            }}
            onNavigateRuns={() => {
              openWorkflows("runs");
              setSelectedResource(null);
            }}
            onOpenSettings={openSettings}
            onSelectResource={(resource) => {
              if (resource.kind === "task" || resource.kind === "taskrun") {
                openWorkflows(resource.kind === "taskrun" ? "runs" : "scheduled");
              } else {
                navigateTo("chat");
              }
              setSelectedResource(resource);
            }}
            activeResourceGroup={
              view === "agents" || selectedResource?.kind === "agent"
                ? "agents"
                : view === "workflows"
                  ? workflowFocus
                  : undefined
            }
            activeRevenueTab={revenueTab}
            activeRunId={runId}
            onNewChat={startNewChat}
            onOpenSession={openSession}
            onToggle={toggleSidebar}
            open={sidebarOpen}
            selected={selectedResource}
            sessions={sessions}
            settingsSection={settingsSection}
            user={shellUser}
            billing={session.billing}
            view={view}
          />
          <main
            className={`flex min-w-0 flex-1 flex-col ${
              view === "settings" ? "settings-stage" : ""
            }`}
          >
            <header
              className={
                view === "settings"
                  ? "settings-stage-header"
                  : "flex h-12 shrink-0 items-center px-5"
              }
            >
              <div className="flex items-center gap-2">
                {/* With the sidebar open on a wide screen, its edge and the [ key
                    close it; the button is only needed to bring it back. */}
                <Button
                  aria-label="Toggle sidebar"
                  className={`size-7 rounded-none text-primary/60 hover:bg-background-100 hover:text-primary dark:hover:bg-background-300 ${
                    sidebarOpen ? "md:hidden" : ""
                  }`}
                  onClick={toggleSidebar}
                  size="icon"
                  title="Toggle sidebar  ["
                  type="button"
                  variant="ghost"
                >
                  <SidebarSimple className="size-4" />
                </Button>
                {view === "chat" && conversation.length === 0 ? null : view === "settings" &&
                  sidebarOpen ? null : (
                  <Label
                    className={
                      view === "settings"
                        ? "settings-stage-header-title font-normal"
                        : "text-[15px] font-normal text-primary"
                    }
                  >
                    {view === "settings"
                      ? SETTINGS_SECTIONS.find((s) => s.key === settingsSection)?.label ||
                        "Settings"
                      : view === "revenue"
                        ? REVENUE_TAB_LABELS[revenueTab]
                        : view === "report"
                          ? "Open promises"
                          : view === "agents"
                            ? "Agents"
                            : view === "workflows"
                              ? workflowFocus === "runs"
                                ? "Runs"
                                : "Workflows"
                              : "Home"}
                  </Label>
                )}
              </div>
            </header>

            <DashboardRouteProvider value={routeContext}>
              <ViewBoundary viewKey={`${view}:${revenueTab}:${settingsSection}`}>
                {children}
              </ViewBoundary>
            </DashboardRouteProvider>
          </main>
        </section>
      </div>
    </div>
  );
}

export default function ProductDashboardClient({
  children,
  initialSession,
}: {
  children: ReactNode;
  initialSession: Extract<BrowserSessionResponse, { authenticated: true }>;
}) {
  return (
    <AuthGate initialSession={initialSession}>
      <div className="app-shell contents" data-product-shell>
        <PageBody>{children}</PageBody>
      </div>
    </AuthGate>
  );
}
