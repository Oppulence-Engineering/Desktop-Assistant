"use client";

import "client-only";

import { useCallback, useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";

import {
  AppShellSidebar,
  AppTopBar,
  REVENUE_TAB_LABELS,
  SETTINGS_SECTIONS,
  ViewBoundary,
} from "@/components/app-shell";
import { useAuthSession } from "@/components/auth-gate";
import { CommandPalette } from "@/components/command-palette";
import { useDashboardChatController } from "@/components/features/dashboard/chat-route-provider/chat-route-provider";
import { useProductRouteState } from "@/hooks/use-product-route-state";
import { SidebarSimple } from "@/lib/icons";
import { useBooleanPref } from "@/lib/console-prefs";
import { Button } from "@oppulence/ui/components/button";
import { Label } from "@oppulence/ui/components/label";
import { cn } from "@oppulence/ui/lib/utils";

export type DashboardShellProps = ComponentPropsWithoutRef<"section">;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

export function DashboardShell({ children, className, ...props }: DashboardShellProps) {
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
  const chat = useDashboardChatController();
  const [sidebarOpen, setSidebarOpen] = useBooleanPref("app-sidebar-open", true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);
  const shellUser = useMemo(
    () => ({
      name: session.user.email || session.user.workosUserId || "User",
      email: session.user.email || session.user.workosUserId || "",
    }),
    [session.user.email, session.user.workosUserId],
  );
  const toggleSidebar = useCallback(() => {
    setSidebarOpen(!sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  /**
   * Shell shortcuts live with the controls they operate. The editable-target
   * guard prevents navigation chrome from consuming normal composer input.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (
        event.key === "[" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const navigateWithoutResource = useCallback(
    (navigate: () => void) => {
      navigate();
      chat.clearSelectedResource();
    },
    [chat],
  );
  const title =
    view === "settings"
      ? SETTINGS_SECTIONS.find((section) => section.key === settingsSection)?.label || "Settings"
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
              : "Home";

  return (
    <section
      ref={setOverlayContainer}
      className={cn(
        "app-shell sim-product-shell sim-landing-root app-vh-shell flex w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]",
        className,
      )}
      data-product-shell
      data-slot="dashboard-shell"
      {...props}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <CommandPalette
          agents={chat.agentOptions}
          onNavigateChat={() => navigateWithoutResource(() => navigateTo("chat"))}
          onNavigateRelationship={() => openRevenueTab("relationships")}
          onNewChat={chat.onNewChat}
          onOpenAgent={chat.onOpenAgent}
          onOpenSession={chat.onOpenSession}
          onOpenSettings={openSettings}
          onOpenChange={setPaletteOpen}
          onToggleSidebar={toggleSidebar}
          open={paletteOpen}
          sessions={chat.sessions}
        />
        <AppTopBar
          onAsk={() => setPaletteOpen(true)}
          onOpenPeople={() => navigateWithoutResource(() => openRevenueTab("people"))}
        />
        <div className="min-h-0 w-full flex-1 md:px-2.5 md:pb-2.5">
          <section
            className={`relative flex h-full overflow-clip border-[var(--border)] border-t bg-[var(--surface-2)] ${
              view === "settings" ? "settings-workspace border-0 md:border-0" : "md:border"
            }`}
            data-slot="dashboard-workspace"
          >
            <AppShellSidebar
              overlayContainer={overlayContainer}
              activeResourceGroup={
                view === "agents" || chat.selectedResource?.kind === "agent"
                  ? "agents"
                  : view === "workflows"
                    ? workflowFocus
                    : undefined
              }
              activeRevenueTab={revenueTab}
              activeRunId={chat.activeRunId}
              billing={session.billing}
              onCloseSettings={() => navigateTo("chat")}
              onNavigateAgents={() => navigateWithoutResource(() => navigateTo("agents"))}
              onNavigateChat={() => navigateWithoutResource(() => navigateTo("chat"))}
              onNavigateReport={() => navigateWithoutResource(() => navigateTo("report"))}
              onNavigateRevenue={(tab) => navigateWithoutResource(() => openRevenueTab(tab))}
              onNavigateRuns={() => navigateWithoutResource(() => openWorkflows("runs"))}
              onNavigateScheduled={() => navigateWithoutResource(() => openWorkflows("scheduled"))}
              onNewChat={chat.onNewChat}
              onOpenSession={chat.onOpenSession}
              onOpenSettings={openSettings}
              onSelectResource={chat.onOpenResource}
              onToggle={toggleSidebar}
              open={sidebarOpen}
              selected={chat.selectedResource}
              sessions={chat.sessions}
              settingsSection={settingsSection}
              user={shellUser}
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
                    : "flex h-12 shrink-0 items-center border-[var(--border)] border-b px-5"
                }
                data-slot="app-stage-header"
              >
                <div className="flex items-center gap-2">
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
                  {view === "chat" && chat.empty ? null : view === "settings" &&
                    sidebarOpen ? null : (
                    <Label
                      className={
                        view === "settings"
                          ? "settings-stage-header-title font-normal"
                          : "text-[var(--text-small,13px)] font-normal text-[var(--text-secondary)]"
                      }
                    >
                      {title}
                    </Label>
                  )}
                </div>
              </header>
              <ViewBoundary viewKey={`${view}:${revenueTab}:${settingsSection}`}>
                {children}
              </ViewBoundary>
            </main>
          </section>
        </div>
      </div>
    </section>
  );
}
