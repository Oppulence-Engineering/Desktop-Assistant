"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Workflow,
  ChevronRight,
  FileText,
  FilePlus,
  Folder,
  Globe,
  AlertTriangle,
  Home,
  Mic,
  SquarePen,
  Plug,
  LoaderIcon,
  Mail,
  MessageSquare,
  Settings,
  Sparkles,
  Square,
  UsersRound,
  Video,
} from "@/lib/icons";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@oppulence/ui/components/alert-dialog";
import { Button } from "@oppulence/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@oppulence/ui/components/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@oppulence/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oppulence/ui/components/tooltip";
import { cn } from "@/lib/utils";
import { dominantServiceFault, explainServiceError } from "@/lib/service-error-copy";
import { SettingsDialog } from "@/components/settings-dialog";
import { updatePending, useUpdateStatus } from "@/hooks/use-update-prompt";
import { extractConferenceLink } from "@/lib/calendar-event";
import { useBilling } from "@/hooks/useBilling";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { toast } from "@/lib/toast";
import { ServiceEvent } from "@x/shared/src/service-events.js";
import type { RelationshipSourceStatus } from "@x/shared/src/relationships.js";
import type { TranscriptionProvider } from "@x/shared/dist/transcription.js";
import {
  PRODUCT_NAME,
  PRODUCT_PROVIDER_ID,
  getProductProviderState,
} from "@x/shared/dist/branding.js";
import z from "zod";
import {
  relationshipSourceHealthSummary,
  relationshipSourceStatusLabel,
} from "@/lib/relationship-source-health";

interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: TreeNode[];
  loaded?: boolean;
  stat?: { size: number; mtimeMs: number };
}

type KnowledgeActions = {
  createNote: (parentPath?: string) => void;
  createFolder: (parentPath?: string) => Promise<string>;
  openGraph: () => void;
  openBases: () => void;
  openKnowledgeView: () => void;
  openWorkspaceAt: (path?: string) => void;
  createWorkspace: (name: string) => Promise<string>;
  expandAll: () => void;
  collapseAll: () => void;
  rename: (path: string, newName: string, isDir: boolean) => Promise<void>;
  remove: (path: string) => Promise<void>;
  copyPath: (path: string) => void;
  revealInFileManager: (path: string, isDir: boolean) => void;
  onOpenInNewTab?: (path: string) => void;
};

function displayNoteName(node: TreeNode): string {
  if (node.kind === "file" && node.name.toLowerCase().endsWith(".md")) {
    return node.name.slice(0, -3);
  }
  return node.name;
}

function formatBillingPlanName(plan: string | null | undefined) {
  if (!plan) return "No plan";
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
}

function formatAgo(ms: number): string {
  const diffMs = Math.max(0, Date.now() - ms);
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.max(1, Math.floor(day / 30));
  return `${mo}mo ago`;
}

type TaskSummary = {
  slug: string;
  name: string;
  active: boolean;
  createdAt: string;
  lastAttemptAt?: string;
  lastRunAt?: string;
  lastRunError?: string;
};

type ServiceEventType = z.infer<typeof ServiceEvent>;

const MAX_SYNC_EVENTS = 1000;
const RUN_STALE_MS = 2 * 60 * 60 * 1000;
const USER_VISIBLE_SERVICE_ACTIVITY = new Set([
  "gmail",
  "calendar",
  "fireflies",
  "granola",
  "graph",
  "voice_memo",
]);

const SERVICE_LABELS: Record<string, string> = {
  gmail: "Syncing Gmail",
  calendar: "Syncing Calendar",
  fireflies: "Syncing Fireflies",
  granola: "Syncing Granola",
  graph: "Updating knowledge",
  voice_memo: "Processing voice memo",
  email_labeling: "Labeling emails",
  note_tagging: "Tagging notes",
  agent_notes: "Updating agent notes",
  memory: "Indexing memory",
};

function summarizeServiceError(error: string): string {
  const firstLine = error.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim() || error.trim();
}

function collectServiceErrors(events: ServiceEventType[]): Map<string, string> {
  const errors = new Map<string, string>();
  for (const event of events) {
    if (event.type === "error") {
      errors.set(event.service, summarizeServiceError(event.error));
      continue;
    }
    if (event.type === "run_complete" && event.outcome !== "error") {
      errors.delete(event.service);
    }
  }
  return errors;
}

type SidebarContentPanelProps = {
  tree: TreeNode[];
  onSelectFile: (path: string, kind: "file" | "dir") => void;
  knowledgeActions: KnowledgeActions;
  bgTaskSummaries?: TaskSummary[];
  onOpenMeetings?: () => void;
  onOpenBgTasks?: () => void;
  onOpenAgent?: (slug: string) => void;
  recentRuns?: { id: string; title?: string; createdAt: string }[];
  onOpenRun?: (runId: string) => void;
  onOpenEmail?: (threadId?: string) => void;
  onOpenRelationships?: (section?: "accounts" | "attention") => void;
  onOpenHome?: () => void;
  onOpenTour?: () => void;
  onNewChat?: () => void;
  onToggleBrowser?: () => void;
  onVoiceNoteCreated?: (path: string) => void;
  /** Keep reconnect controls available without auto-opening another prompt in local mode. */
  suppressOauthAlerts?: boolean;
  /** Which primary destination is currently active, for nav highlighting. */
  activeNav?:
    | "home"
    | "accounts"
    | "attention"
    | "email"
    | "meetings"
    | "knowledge"
    | "agents"
    | "workspaces"
    | null;
  /** Live meeting recording state, so the recording row can show its indicator/stop. */
  meetingRecordingState?: "idle" | "connecting" | "recording" | "stopping";
  recordingMeetingSource?: string | null;
  onToggleMeetingRecording?: () => void;
} & React.ComponentProps<typeof Sidebar>;

function formatEventTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatSourceLag(seconds: number): string {
  if (seconds < 60) return "current";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m behind`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h behind`;
  return `${Math.floor(hours / 24)}d behind`;
}

function SyncStatusBar({ voiceRecording }: { voiceRecording?: VoiceNoteStatus | null }) {
  const { state } = useSidebar();
  const [activeServices, setActiveServices] = useState<Map<string, string>>(new Map());
  const [serviceErrors, setServiceErrors] = useState<Map<string, string>>(new Map());
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [logEvents, setLogEvents] = useState<ServiceEventType[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [relationshipSources, setRelationshipSources] = useState<RelationshipSourceStatus[]>([]);
  const [upgradePending, setUpgradePending] = useState(false);
  const runTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Same checkout the billing dialog opens, so the two entry points cannot
  // drift onto different plans.
  const openUpgrade = useCallback(async () => {
    setUpgradePending(true);
    try {
      const checkout = await window.ipc.invoke("billing:getCheckoutUrl", { plan: "starter" });
      window.open(checkout.url);
    } catch (error) {
      console.error("Failed to open billing flow:", error);
      toast("Could not open the upgrade page.", "error");
    } finally {
      setUpgradePending(false);
    }
  }, []);

  const refreshRelationshipSources = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("relationships:sources", null);
      setRelationshipSources(result.sources);
    } catch {
      setRelationshipSources([]);
    }
  }, []);

  useEffect(() => {
    void refreshRelationshipSources();
    const timer = window.setInterval(() => void refreshRelationshipSources(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshRelationshipSources]);

  // Track active runs from real-time events
  useEffect(() => {
    const cleanup = window.ipc.on("services:events", (event) => {
      const nextEvent = event as ServiceEventType;
      if (nextEvent.type === "run_start") {
        setActiveServices((prev) => {
          const next = new Map(prev);
          next.set(nextEvent.runId, nextEvent.service);
          return next;
        });
        const existingTimeout = runTimeoutsRef.current.get(nextEvent.runId);
        if (existingTimeout) clearTimeout(existingTimeout);
        const timeout = setTimeout(() => {
          setActiveServices((prev) => {
            if (!prev.has(nextEvent.runId)) return prev;
            const next = new Map(prev);
            next.delete(nextEvent.runId);
            return next;
          });
          runTimeoutsRef.current.delete(nextEvent.runId);
        }, RUN_STALE_MS);
        runTimeoutsRef.current.set(nextEvent.runId, timeout);
      } else if (nextEvent.type === "run_complete") {
        setActiveServices((prev) => {
          const next = new Map(prev);
          next.delete(nextEvent.runId);
          return next;
        });
        if (nextEvent.outcome !== "error") {
          setServiceErrors((prev) => {
            if (!prev.has(nextEvent.service)) return prev;
            const next = new Map(prev);
            next.delete(nextEvent.service);
            return next;
          });
        }
        const existingTimeout = runTimeoutsRef.current.get(nextEvent.runId);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          runTimeoutsRef.current.delete(nextEvent.runId);
        }
      } else if (nextEvent.type === "error") {
        setServiceErrors((prev) => {
          const next = new Map(prev);
          next.set(nextEvent.service, summarizeServiceError(nextEvent.error));
          return next;
        });
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    return () => {
      runTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      runTimeoutsRef.current.clear();
    };
  }, []);

  // Load logs from JSONL file when popover opens
  useEffect(() => {
    if (!popoverOpen) return;
    let cancelled = false;
    async function loadLogs() {
      setLogLoading(true);
      void refreshRelationshipSources();
      try {
        const result = await window.ipc.invoke("workspace:readFile", {
          path: "logs/services.jsonl",
          encoding: "utf8",
        });
        if (cancelled) return;
        const lines = result.data.trim().split("\n").filter(Boolean);
        const parsed: ServiceEventType[] = [];
        for (const line of lines) {
          try {
            parsed.push(JSON.parse(line));
          } catch {
            // skip malformed lines
          }
        }
        setServiceErrors(collectServiceErrors(parsed));
        // Newest first, limit to 1000
        setLogEvents(parsed.reverse().slice(0, MAX_SYNC_EVENTS));
      } catch {
        if (!cancelled) {
          setLogEvents([]);
          setServiceErrors(new Map());
        }
      } finally {
        if (!cancelled) setLogLoading(false);
      }
    }
    loadLogs();
    return () => {
      cancelled = true;
    };
  }, [popoverOpen, refreshRelationshipSources]);

  const isSyncing = activeServices.size > 0;
  const isCollapsed = state === "collapsed";
  const errorEntries = Array.from(serviceErrors.entries());
  const primaryErrorService = errorEntries[0]?.[0] ?? null;
  const hasServiceErrors = errorEntries.length > 0;
  const dominantFault = dominantServiceFault(serviceErrors.values());
  const sourceHealth = relationshipSourceHealthSummary(relationshipSources);
  const hasSourceAttention = sourceHealth.needsAttention.length > 0;
  const hasSourceSyncing = sourceHealth.syncing.length > 0;
  const visibleLogEvents = logEvents.filter((event) => {
    if (event.level === "error" || event.level === "warn") return true;
    if (!USER_VISIBLE_SERVICE_ACTIVITY.has(event.service)) return false;
    if (event.type === "changes_identified") return true;
    return event.type === "run_complete" && event.outcome === "ok";
  });

  // Build status label from active services.
  //
  // A service that polls every 10-15s and fails every pass still produces a
  // steady stream of run_start events, so activeServices is essentially never
  // empty for it. Ranking "syncing" above "failing" therefore pinned the label
  // to "Labeling emails, Updating knowledge, Indexing memory" for eleven hours
  // while 100% of those batches were erroring on insufficient_credits — the
  // failure branch below was unreachable in exactly the case it exists for.
  // Retrying is not progress: a service that is both active and failing is
  // reported as failing.
  const activeServiceNames = [...new Set(activeServices.values())];
  const failingActive = activeServiceNames.filter((s) => serviceErrors.has(s));
  const progressingServices = activeServiceNames.filter((s) => !serviceErrors.has(s));
  const isProgressing = progressingServices.length > 0;
  const statusLabel = failingActive.length
    ? failingActive.length === 1
      ? `${SERVICE_LABELS[failingActive[0]] || failingActive[0]} failing`
      : `${failingActive.length} services failing`
    : isProgressing
      ? progressingServices.map((s) => SERVICE_LABELS[s] || s).join(", ")
      : hasSourceAttention
        ? `${sourceHealth.needsAttention.length} source${sourceHealth.needsAttention.length === 1 ? "" : "s"} need attention`
        : hasServiceErrors
          ? errorEntries.length === 1
            ? `${SERVICE_LABELS[primaryErrorService ?? ""] || primaryErrorService} failed`
            : "Recent sync issues"
          : hasSourceSyncing
            ? `${sourceHealth.syncing.length} source${sourceHealth.syncing.length === 1 ? "" : "s"} building history`
            : relationshipSources.length > 0
              ? "Evidence sources healthy"
              : "Connect evidence sources";

  return (
    <SidebarFooter className="border-t border-sidebar-border px-2 py-2">
      {/* Collapsed-rail status stack. The quick-action row (and with it the mic
            button) is hidden in the icon rail, so an in-flight recording surfaces
            here — and stays stoppable — without expanding the sidebar. Laid out in
            flow rather than as a fixed overlay: the rail's footer column is only
            66px wide, so anything pinned to bottom-left covers the buttons already
            sitting there ("Take a tour", and the status trigger below). */}
      {isCollapsed && (voiceRecording || isSyncing || hasSourceAttention || hasServiceErrors) && (
        <div className="flex flex-col items-center gap-2 pb-1" data-slot="sidebar-rail-status">
          {voiceRecording?.phase === "recording" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={voiceRecording.stop}
                  aria-label="Stop recording"
                  className="flex h-8 w-8 items-center justify-center border border-border bg-background hover:bg-sidebar-accent"
                >
                  <Square className="h-3.5 w-3.5 animate-pulse fill-red-500 text-red-500" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Stop recording</TooltipContent>
            </Tooltip>
          )}
          {voiceRecording?.phase === "transcribing" && (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A mic rather than a spinner, so it is not mistaken for the sync
                    pill directly below it. Not a button — the audio is already
                    submitted, so there is nothing left to cancel. */}
                <div
                  role="status"
                  aria-label="Transcribing voice note"
                  className="flex h-8 w-8 items-center justify-center border border-border bg-background"
                >
                  <Mic className="h-4 w-4 animate-pulse text-red-500" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Transcribing…</TooltipContent>
            </Tooltip>
          )}
          {(isSyncing || hasSourceAttention || hasServiceErrors) && (
            <div
              role="status"
              aria-label={statusLabel}
              className="flex h-8 w-8 items-center justify-center border border-border bg-background"
            >
              {/* Spinner only for work that is actually getting somewhere —
                  a failing retry loop shows the warning, matching the label. */}
              {isProgressing ? (
                <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
            </div>
          )}
        </div>
      )}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-none px-2 py-1 text-xs hover:bg-sidebar-accent",
              (hasSourceAttention || hasServiceErrors) && !isProgressing
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              {isProgressing ? (
                <LoaderIcon className="h-3 w-3 shrink-0 animate-spin" />
              ) : hasSourceAttention || hasServiceErrors ? (
                <AlertTriangle className="h-3 w-3 shrink-0" />
              ) : (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
              )}
              <span className="truncate">{statusLabel}</span>
            </span>
            <ChevronRight className="h-3 w-3 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" sideOffset={4} className="w-96 p-0">
          <div className="p-3 border-b">
            <h4 className="font-semibold text-sm">Data health</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{statusLabel}</p>
            {/* One line naming the cause behind the failures below, plus the
                way out of it. When credits run out every service fails at once,
                and the panel previously listed twenty identical red codes with
                nothing saying what to do — while an Upgrade button sat unused
                in this same sidebar. */}
            {dominantFault && (
              <div className="mt-2 flex items-start justify-between gap-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">{dominantFault.text}</p>
                {dominantFault.fault === "billing" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-xs"
                    disabled={upgradePending}
                    onClick={openUpgrade}
                  >
                    Upgrade
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {relationshipSources.length > 0 ? (
              <div className="mb-2 space-y-1" aria-label="Evidence source health">
                {relationshipSources.map((source) => (
                  <div
                    key={`${source.source}:${source.sourceAccountId}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium capitalize">{source.source}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {relationshipSourceStatusLabel(source)} ·{" "}
                        {formatSourceLag(source.lagSeconds)}
                      </p>
                    </div>
                    {source.missingScopes.length > 0 ? (
                      <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">
                        Permission needed
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {logLoading ? (
              <div className="flex items-center justify-center py-4">
                <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : visibleLogEvents.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                {relationshipSources.length === 0
                  ? "Connect Google, Slack, or HubSpot to build relationship evidence."
                  : "No recent source activity."}
              </div>
            ) : (
              <div className="space-y-0.5 border-t border-border pt-2">
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  Recent source activity
                </p>
                {visibleLogEvents.slice(0, 20).map((event, idx) => (
                  <div
                    key={`${event.runId}-${event.ts}-${idx}`}
                    className="flex items-start gap-2 rounded-none px-2 py-1 text-xs hover:bg-accent"
                  >
                    <span className="shrink-0 text-[10px] leading-4 text-muted-foreground/70">
                      {formatEventTime(event.ts)}
                    </span>
                    <span className="shrink-0">
                      <span
                        className={cn(
                          "inline-block rounded-md px-1 py-0.5 text-[10px] font-medium leading-none",
                          event.level === "error"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : event.level === "warn"
                              ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {SERVICE_LABELS[event.service]?.split(" ").slice(-1)[0] || event.service}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="leading-4 text-foreground/80">{event.message}</p>
                      {event.type === "error" && (
                        // The raw code stays on the title attribute: it is what
                        // makes a bug report actionable, but it is not copy.
                        <p
                          className="truncate text-[11px] leading-4 text-red-600/90 dark:text-red-400/90"
                          title={event.error}
                        >
                          {explainServiceError(event.error).text}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarFooter>
  );
}

export function SidebarContentPanel({
  tree,
  onSelectFile,
  knowledgeActions,
  bgTaskSummaries = [],
  onOpenMeetings,
  onOpenBgTasks,
  onOpenAgent,
  recentRuns = [],
  onOpenRun,
  onOpenEmail,
  onOpenRelationships,
  onOpenHome,
  onOpenTour,
  onNewChat,
  onToggleBrowser,
  onVoiceNoteCreated,
  suppressOauthAlerts = false,
  activeNav,
  meetingRecordingState = "idle",
  recordingMeetingSource = null,
  onToggleMeetingRecording,
  ...props
}: SidebarContentPanelProps) {
  const [hasOauthError, setHasOauthError] = useState(false);
  const [showOauthAlert, setShowOauthAlert] = useState(true);
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false);
  // Read-only: the prompting hook is mounted once at the app root.
  const updateWaiting = updatePending(useUpdateStatus());
  const [openConnectionsAfterClose, setOpenConnectionsAfterClose] = useState(false);
  const connectorsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isSolomonConnected, setIsSolomonConnected] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const { billing } = useBilling(isSolomonConnected);
  const { state: sidebarState } = useSidebar();
  const isCollapsed = sidebarState === "collapsed";
  const [voiceRecording, setVoiceRecording] = useState<VoiceNoteStatus | null>(null);

  // Nav previews: unread important emails + next upcoming meetings (top 2 each).
  const [unreadEmailCount, setUnreadEmailCount] = useState(0);
  const [emailThreads, setEmailThreads] = useState<SidebarEmailThread[]>([]);
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const [quickAccessExpanded, setQuickAccessExpanded] = useState(true);

  useEffect(() => {
    if (!suppressOauthAlerts) return;
    setShowOauthAlert(false);
    setOpenConnectionsAfterClose(false);
  }, [suppressOauthAlerts]);

  useEffect(() => {
    let cancelled = false;
    const loadEmail = async () => {
      try {
        const result = await window.ipc.invoke("gmail:getImportant", {
          limit: 50,
        });
        if (cancelled) return;
        const unread = result.threads.filter((t) => t.unread === true);
        setUnreadEmailCount(unread.length);
        setEmailThreads(
          unread.slice(0, 1).map((t) => ({
            threadId: t.threadId,
            subject: t.subject ?? "(No subject)",
            from: t.from ?? "",
            date: t.date ?? "",
          })),
        );
      } catch {
        /* ignore */
      }
    };
    void loadEmail();
    const cleanup = window.ipc.on("workspace:didChange", (event) => {
      const paths =
        event.type === "bulkChanged"
          ? (event.paths ?? [])
          : event.type === "moved"
            ? [event.from, event.to]
            : "path" in event
              ? [event.path]
              : [];
      if (paths.some((p) => typeof p === "string" && p.startsWith("gmail_sync"))) void loadEmail();
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadNext = async () => {
      try {
        const exists = await window.ipc.invoke("workspace:exists", {
          path: "calendar_sync",
        });
        if (!exists.exists) {
          if (!cancelled) setMeetings([]);
          return;
        }
        const entries = await window.ipc.invoke("workspace:readdir", {
          path: "calendar_sync",
          opts: { recursive: false, includeHidden: false, includeStats: false },
        });
        const jsonEntries = entries.filter((e) => e.kind === "file" && e.name.endsWith(".json"));
        const settled = await Promise.allSettled(
          jsonEntries.map(async (entry) => {
            const result = await window.ipc.invoke("workspace:readFile", {
              path: entry.path,
              encoding: "utf8",
            });
            return normalizeUpcomingMeeting(
              JSON.parse(result.data) as RawCalendarEvent,
              entry.path,
            );
          }),
        );
        const items: UpcomingMeeting[] = [];
        for (const r of settled) if (r.status === "fulfilled" && r.value) items.push(r.value);
        items.sort((a, b) => {
          if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
          return a.start.getTime() - b.start.getTime();
        });
        if (!cancelled) setMeetings(items.slice(0, 1));
      } catch {
        /* ignore */
      }
    };
    void loadNext();
    const cleanup = window.ipc.on("workspace:didChange", (event) => {
      const paths =
        event.type === "bulkChanged"
          ? (event.paths ?? [])
          : event.type === "moved"
            ? [event.from, event.to]
            : "path" in event
              ? [event.path]
              : [];
      if (paths.some((p) => typeof p === "string" && p.startsWith("calendar_sync")))
        void loadNext();
    });
    const tick = setInterval(() => void loadNext(), 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      cleanup();
    };
  }, []);

  const recentNotes = React.useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (
          n.path === "knowledge/Meetings" ||
          n.path === "knowledge/Workspace" ||
          n.path === "knowledge/Agent Notes"
        )
          continue;
        if (n.kind === "file") out.push(n);
        else if (n.children?.length) walk(n.children);
      }
    };
    walk(tree);
    return out
      .filter((n) => n.stat?.mtimeMs)
      .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
      .slice(0, 10);
  }, [tree]);

  // Recents: most recently touched notes / agents / chats, interleaved by
  // recency. Capped per type (4 notes, 4 agents, 4 chats) and 12 overall.
  type QuickAccessItem = {
    key: string;
    label: string;
    recency: number;
    type: "note" | "agent" | "chat";
    onClick: () => void;
  };
  const quickAccessItems = React.useMemo<QuickAccessItem[]>(() => {
    const items: QuickAccessItem[] = [];

    for (const note of recentNotes.slice(0, 4)) {
      items.push({
        key: `note:${note.path}`,
        label: displayNoteName(note),
        recency: note.stat?.mtimeMs ?? 0,
        type: "note",
        onClick: () => onSelectFile(note.path, "file"),
      });
    }

    const agentRecency = (t: TaskSummary) => {
      const ts = t.lastRunAt ?? t.lastAttemptAt ?? t.createdAt;
      const ms = ts ? new Date(ts).getTime() : 0;
      return Number.isFinite(ms) ? ms : 0;
    };
    for (const t of [...bgTaskSummaries]
      .sort((a, b) => agentRecency(b) - agentRecency(a))
      .slice(0, 4)) {
      items.push({
        key: `agent:${t.slug}`,
        label: t.name,
        recency: agentRecency(t),
        type: "agent",
        onClick: () => onOpenAgent?.(t.slug),
      });
    }

    const chatRecency = (r: { createdAt: string }) => {
      const ms = new Date(r.createdAt).getTime();
      return Number.isFinite(ms) ? ms : 0;
    };
    for (const r of [...recentRuns].sort((a, b) => chatRecency(b) - chatRecency(a)).slice(0, 4)) {
      items.push({
        key: `chat:${r.id}`,
        label: r.title || "(Untitled chat)",
        recency: chatRecency(r),
        type: "chat",
        onClick: () => onOpenRun?.(r.id),
      });
    }

    return items.sort((a, b) => b.recency - a.recency).slice(0, 12);
  }, [recentNotes, bgTaskSummaries, recentRuns, onSelectFile, onOpenAgent, onOpenRun]);

  // Workspace count for the Workspaces sublabel — top-level dir children of
  // knowledge/Workspace (matches WorkspaceView's root listing).
  const workspaceCount = React.useMemo(() => {
    const find = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.path === "knowledge/Workspace") return n;
        if (n.kind === "dir" && n.children?.length) {
          const found = find(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    const node = find(tree);
    return node?.children?.filter((c) => c.kind === "dir").length ?? 0;
  }, [tree]);

  // "Updated 4m ago" sublabel under Knowledge, based on the most recently
  // modified note. Recomputed in an effect (not during render) and ticked so
  // the relative time stays fresh.
  const latestNoteMtime = recentNotes[0]?.stat?.mtimeMs ?? null;
  const [knowledgeUpdatedLabel, setKnowledgeUpdatedLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!latestNoteMtime) {
      setKnowledgeUpdatedLabel(null);
      return;
    }
    const update = () => setKnowledgeUpdatedLabel(`Updated ${formatAgo(latestNoteMtime)}`);
    update();
    const tick = setInterval(update, 60 * 1000);
    return () => clearInterval(tick);
  }, [latestNoteMtime]);

  // "2 active · Last run 3m ago" sublabel under Background tasks, overridden by
  // "N failed · Needs review" when any task's last run errored.
  const [bgAgentsLabel, setBgAgentsLabel] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const failed = bgTaskSummaries.filter((t) => t.lastRunError).length;
      if (failed > 0) {
        setBgAgentsLabel(`${failed} failed · Needs review`);
        return;
      }
      const active = bgTaskSummaries.filter((t) => t.active).length;
      const lastRunMs = bgTaskSummaries.reduce((max, t) => {
        const ms = t.lastRunAt ? new Date(t.lastRunAt).getTime() : 0;
        return Number.isFinite(ms) && ms > max ? ms : max;
      }, 0);
      const parts: string[] = [active > 0 ? `${active} active` : "No active tasks"];
      if (lastRunMs > 0) parts.push(`Last run ${formatAgo(lastRunMs)}`);
      setBgAgentsLabel(parts.join(" · "));
    };
    update();
    const tick = setInterval(update, 60 * 1000);
    return () => clearInterval(tick);
  }, [bgTaskSummaries]);

  const handleSolomonLogin = useCallback(async () => {
    try {
      setLoggingIn(true);
      const result = await window.ipc.invoke("oauth:connect", {
        provider: PRODUCT_PROVIDER_ID,
      });
      if (!result.success) {
        setLoggingIn(false);
      }
    } catch {
      setLoggingIn(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const refreshOauthError = async () => {
      try {
        const result = await window.ipc.invoke("oauth:getState", null);
        const config = result.config || {};
        const hasError = Object.values(config).some((entry) => Boolean(entry?.error));
        const connected = getProductProviderState(config)?.connected ?? false;
        if (mounted) {
          setHasOauthError(hasError);
          setIsSolomonConnected(connected);
          if (!hasError) {
            setShowOauthAlert(true);
          }
        }
        if (connected && mounted) {
          try {
            const account = await window.ipc.invoke("account:getSolomon", null);
            if (mounted) setAppUrl(account.config?.appUrl ?? null);
          } catch {
            /* ignore */
          }
        }
      } catch (error) {
        console.error("Failed to fetch OAuth state:", error);
        if (mounted) {
          setHasOauthError(false);
          setIsSolomonConnected(false);
          setShowOauthAlert(true);
        }
      }
    };

    refreshOauthError();
    const cleanup = window.ipc.on("oauth:didConnect", () => {
      refreshOauthError();
      setLoggingIn(false);
    });

    return () => {
      mounted = false;
      cleanup();
    };
  }, []);

  // Single preview shown as a sublabel on the Email / Meetings nav buttons.
  const previewEmail = emailThreads[0];
  const previewMeeting = meetings[0];
  // Drive the recording indicator off the global recording state — there is only
  // one active recording, so it must show even for ad-hoc recordings or meetings
  // that aren't the upcoming one previewed here.
  const meetingIsRecording =
    meetingRecordingState === "recording" ||
    meetingRecordingState === "connecting" ||
    meetingRecordingState === "stopping";
  const meetingIsBusy =
    meetingRecordingState === "connecting" || meetingRecordingState === "stopping";
  // Title of the meeting being recorded, when it's the upcoming one we preview.
  const recordingMeeting =
    previewMeeting != null && recordingMeetingSource === previewMeeting.source
      ? previewMeeting
      : null;
  const meetingSublabel = meetingIsRecording
    ? (recordingMeeting?.summary ?? "Recording…")
    : previewMeeting
      ? `${previewMeeting.summary} · ${formatMeetingTime(previewMeeting)}`
      : null;

  return (
    <Sidebar className="rowboat-sidebar border-r-0" variant="inset" collapsible="icon" {...props}>
      <SidebarHeader className="titlebar-drag-region shrink-0 p-0">
        {/* Keep the sidebar toggle and quick actions in one compact chrome row.
            The icon rail leaves ~50px of content box — the actions cannot fit and
            would spill out over the content header — so only the toggle survives
            there, centered. overflow-hidden is the structural guard. */}
        <div
          className={cn(
            "titlebar-no-drag flex h-10 items-center overflow-hidden",
            isCollapsed ? "justify-center" : "gap-2 pr-2",
          )}
        >
          <SidebarTrigger
            className={cn(
              "size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              !isCollapsed && "-ml-2",
            )}
          />
          {/* Hidden, not unmounted: VoiceNoteButton cancels any in-flight recording
              in its unmount cleanup, so tearing this down on collapse would discard
              the audio and strand the note at "Recording in progress". display:none
              contributes no width, so the row still cannot overflow the rail. */}
          <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", isCollapsed && "hidden")}>
            {onNewChat && <ActionButton icon={SquarePen} label="New chat" onClick={onNewChat} />}
            <ActionButton
              icon={FilePlus}
              label="New note"
              onClick={() => knowledgeActions.createNote()}
            />
            <VoiceNoteButton
              onNoteCreated={onVoiceNoteCreated}
              variant="action"
              onRecordingChange={setVoiceRecording}
            />
            {onToggleBrowser && (
              <ActionButton icon={Globe} label="Run browser task" onClick={onToggleBrowser} />
            )}
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* Primary navigation */}
        <SidebarGroup className="flex flex-col">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "home"}
                  tooltip="Home"
                  onClick={onOpenHome}
                  data-tour-target="home"
                >
                  <Home className="size-4 shrink-0" />
                  <span className="flex-1 truncate">Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "accounts"}
                  tooltip="Accounts"
                  onClick={() => onOpenRelationships?.("accounts")}
                  className="h-auto py-1.5"
                  data-tour-target="accounts"
                >
                  <UsersRound className="size-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Accounts</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      Relationship mission control
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "attention"}
                  tooltip="Attention queue"
                  onClick={() => onOpenRelationships?.("attention")}
                  className="h-auto py-1.5"
                  data-tour-target="attention-nav"
                >
                  <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Attention queue</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      Risks, commitments, next actions
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "email"}
                  tooltip="Evidence inbox"
                  onClick={() => onOpenEmail?.()}
                  className={previewEmail ? "h-auto py-1.5" : undefined}
                  data-tour-target="evidence-inbox"
                >
                  <Mail className="size-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Evidence inbox</span>
                    {previewEmail && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {formatEmailFrom(previewEmail.from)} · {previewEmail.subject}
                      </span>
                    )}
                  </div>
                  {unreadEmailCount > 0 && (
                    <span className="shrink-0 self-center rounded-full bg-sidebar-accent px-1.5 text-[10px] font-medium text-sidebar-accent-foreground tabular-nums">
                      {unreadEmailCount}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "meetings"}
                  tooltip="Meetings"
                  onClick={onOpenMeetings}
                  className={meetingSublabel ? "h-auto py-1.5" : undefined}
                  data-tour-target="meetings"
                >
                  <Mic className={cn("size-4 shrink-0", meetingIsRecording && "text-red-500")} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Meetings</span>
                    {meetingSublabel && (
                      <span
                        className={cn(
                          "truncate text-[11px]",
                          meetingIsRecording ? "text-red-500" : "text-muted-foreground",
                        )}
                      >
                        {meetingSublabel}
                      </span>
                    )}
                  </div>
                </SidebarMenuButton>
                {meetingIsRecording ? (
                  <div className="absolute inset-y-0 right-1 flex items-center gap-1.5">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Stop recording"
                          disabled={meetingIsBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleMeetingRecording?.();
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="flex aspect-square w-5 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {meetingIsBusy ? (
                            <LoaderIcon className="size-4 animate-spin" />
                          ) : (
                            <Square className="size-3.5 fill-current" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {meetingRecordingState === "connecting"
                          ? "Starting…"
                          : meetingRecordingState === "stopping"
                            ? "Stopping…"
                            : "Stop recording"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : previewMeeting ? (
                  <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Take notes"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerMeetingCapture(previewMeeting, false);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        >
                          <Mic className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Take notes</TooltipContent>
                    </Tooltip>
                    {previewMeeting.conferenceLink && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Join & take notes"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerMeetingCapture(previewMeeting, true);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          >
                            <Video className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Join & take notes</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ) : null}
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "knowledge"}
                  tooltip="Evidence graph"
                  onClick={() => knowledgeActions.openKnowledgeView()}
                  className={knowledgeUpdatedLabel ? "h-auto py-1.5" : undefined}
                  data-tour-target="evidence-nav"
                >
                  <FileText className="size-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">Evidence graph</span>
                    {knowledgeUpdatedLabel && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {knowledgeUpdatedLabel}
                      </span>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <div className="mx-3 my-2 border-t border-sidebar-border" />

            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "agents"}
                  tooltip="Actions"
                  onClick={onOpenBgTasks}
                  className={bgAgentsLabel ? "h-auto py-1.5" : undefined}
                  data-tour-target="actions"
                >
                  <Workflow className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-muted-foreground">Actions</span>
                    {bgAgentsLabel && (
                      <span
                        className={cn(
                          "truncate text-[11px]",
                          bgTaskSummaries.some((t) => t.lastRunError)
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {bgAgentsLabel}
                      </span>
                    )}
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeNav === "workspaces"}
                  tooltip="Workspaces"
                  onClick={() => knowledgeActions.openWorkspaceAt()}
                  className="h-auto py-1.5"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-muted-foreground">Workspaces</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {workspaceCount === 0
                        ? "Add investigation workspace"
                        : `${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"}`}
                    </span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 border-t border-sidebar-border" />

        {/* Recents */}
        <SidebarGroup className={cn("flex flex-col", isCollapsed && "hidden")}>
          <SidebarGroupContent>
            <button
              type="button"
              onClick={() => setQuickAccessExpanded((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <ChevronRight
                className={cn("size-3 transition-transform", quickAccessExpanded && "rotate-90")}
              />
              <span className="flex-1 text-left">Recents</span>
            </button>
            {quickAccessExpanded &&
              (quickAccessItems.length === 0 ? (
                <div className="px-4 pb-2 text-[11.5px] italic text-muted-foreground">
                  Recent notes and tasks show up here.
                </div>
              ) : (
                <SidebarMenu>
                  {quickAccessItems.map((item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton onClick={item.onClick}>
                        {item.type === "agent" ? (
                          <Workflow className="size-4 shrink-0 text-muted-foreground" />
                        ) : item.type === "chat" ? (
                          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="flex-1 truncate">{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              ))}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {/* Billing / upgrade CTA or Log in CTA */}
      {isSolomonConnected && billing && !isCollapsed ? (
        <div className="px-3 py-2">
          <div className="flex items-center justify-between rounded-none border border-sidebar-border bg-sidebar-accent/20 px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs font-medium capitalize text-sidebar-foreground">
                {formatBillingPlanName(billing.subscriptionPlan)}
              </span>
              {billing.subscriptionStatus === "trialing" &&
                billing.trialExpiresAt &&
                (() => {
                  const days = Math.max(
                    0,
                    Math.ceil(
                      (new Date(billing.trialExpiresAt).getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24),
                    ),
                  );
                  return (
                    <p className="text-[10px] text-sidebar-foreground/60">
                      {days === 0
                        ? "Trial expires today"
                        : days === 1
                          ? "1 day left"
                          : `${days} days left`}
                    </p>
                  );
                })()}
            </div>
            <button
              onClick={() => appUrl && window.open(`${appUrl}?intent=upgrade`)}
              className="shrink-0 rounded-none bg-sidebar-foreground/10 px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-foreground/20"
            >
              {!billing.subscriptionPlan ||
              billing.subscriptionPlan === "free" ||
              billing.subscriptionPlan === "starter"
                ? "Upgrade"
                : "Manage"}
            </button>
          </div>
        </div>
      ) : null}
      {/* Sign in CTA */}
      {!isSolomonConnected && !isCollapsed && (
        <div className="px-3 py-2">
          <button
            onClick={handleSolomonLogin}
            disabled={loggingIn}
            className="flex w-full items-center justify-center rounded-none border border-sidebar-border bg-sidebar-accent/20 px-3 py-2.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/40 disabled:opacity-50"
          >
            {loggingIn ? "Signing in..." : `Sign in to ${PRODUCT_NAME}`}
          </button>
        </div>
      )}
      {/* Bottom actions */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              ref={connectorsButtonRef}
              onClick={() => setConnectionsSettingsOpen(true)}
              aria-label="Connect Accounts"
              title="Connect Accounts"
              data-tour-target="connections"
              className={cn(
                "flex items-center gap-2 rounded-lg py-1 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isCollapsed ? "size-8 justify-center px-0" : "w-full px-2",
              )}
            >
              <Plug className="size-4" />
              <span className={isCollapsed ? "sr-only" : undefined}>Connect Accounts</span>
            </button>
            {hasOauthError && (
              <AlertDialog open={showOauthAlert} onOpenChange={setShowOauthAlert}>
                <button
                  type="button"
                  className="inline-flex items-center"
                  aria-label="OAuth connection issues"
                  aria-expanded={showOauthAlert}
                  onClick={() => setShowOauthAlert(true)}
                >
                  <AlertTriangle className="size-3 text-amber-500/90 animate-pulse" />
                </button>
                <AlertDialogContent
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    if (openConnectionsAfterClose) {
                      setOpenConnectionsAfterClose(false);
                      setConnectionsSettingsOpen(true);
                    }
                    connectorsButtonRef.current?.focus();
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reconnect your accounts</AlertDialogTitle>
                    <AlertDialogDescription>
                      One or more connected accounts need attention. Open Connected accounts to
                      review the status and reconnect if needed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOpenConnectionsAfterClose(false);
                        setShowOauthAlert(false);
                      }}
                    >
                      Dismiss
                    </Button>
                    <Button
                      onClick={() => {
                        setOpenConnectionsAfterClose(true);
                        setShowOauthAlert(false);
                      }}
                    >
                      View connected accounts
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <SettingsDialog onStartTour={onOpenTour}>
            <button
              aria-label={updateWaiting ? "Settings — update available" : "Settings"}
              title={updateWaiting ? "Settings — update available" : "Settings"}
              data-tour-target="settings"
              className={cn(
                "flex items-center gap-2 rounded-lg py-1 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isCollapsed ? "size-8 justify-center px-0" : "w-full px-2",
              )}
            >
              <span className="relative flex shrink-0">
                <Settings className="size-4" />
                {/* Outlives the toast: dismissing the prompt shouldn't be the
                    same as never being told an update exists. */}
                {updateWaiting && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-sky-500 ring-2 ring-sidebar"
                  />
                )}
              </span>
              <span className={isCollapsed ? "sr-only" : undefined}>Settings</span>
            </button>
          </SettingsDialog>
          {onOpenTour && (
            <button
              type="button"
              aria-label="Take a tour"
              title="Take a tour"
              data-tour-target="tour-button"
              onClick={onOpenTour}
              className={cn(
                "flex items-center gap-2 rounded-none py-1 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isCollapsed ? "size-8 justify-center px-0" : "w-full px-2",
              )}
            >
              <Sparkles className="size-4" />
              <span className={isCollapsed ? "sr-only" : undefined}>Take a tour</span>
            </button>
          )}
        </div>
      </div>
      <SettingsDialog
        defaultTab="connections"
        open={connectionsSettingsOpen}
        onOpenChange={setConnectionsSettingsOpen}
      />
      <SyncStatusBar voiceRecording={voiceRecording} />
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * Live phase of a voice note. `stop` is present only while recording — once the
 * audio is submitted there is nothing left to cancel, so the surface showing it
 * must render a non-interactive indicator instead.
 */
export type VoiceNoteStatus = { phase: "recording"; stop: () => void } | { phase: "transcribing" };

// Voice Note Recording Button
export function VoiceNoteButton({
  onNoteCreated,
  variant = "icon",
  onRecordingChange,
}: {
  onNoteCreated?: (path: string) => void;
  variant?: "icon" | "action";
  /**
   * Published whenever the voice-note phase changes, carrying a stop handler
   * only while a recording is live. Lets a surface that stays visible when this
   * button is hidden (the collapsed rail's status pill) mirror the phase and end
   * the recording.
   */
  onRecordingChange?: (status: VoiceNoteStatus | null) => void;
}) {
  const voice = useVoiceMode();
  const [isRecording, setIsRecording] = React.useState(false);
  const [available, setAvailable] = React.useState(false);
  const isTranscribing = voice.state === "transcribing";
  const notePathRef = React.useRef<string | null>(null);
  const relativePathRef = React.useRef<string | null>(null);
  const recordedAtRef = React.useRef<string | null>(null);
  const providerRef = React.useRef<TranscriptionProvider>("none");
  // Keep a ref to always call the latest onNoteCreated (avoids stale closure in recorder.onstop)
  const onNoteCreatedRef = React.useRef(onNoteCreated);
  React.useEffect(() => {
    onNoteCreatedRef.current = onNoteCreated;
  }, [onNoteCreated]);
  const onRecordingChangeRef = React.useRef(onRecordingChange);
  React.useEffect(() => {
    onRecordingChangeRef.current = onRecordingChange;
  }, [onRecordingChange]);
  const stopRecordingRef = React.useRef<(() => void) | null>(null);
  const stoppingRef = React.useRef(false);
  // The mount effect's cleanup needs the recording state and note writer as they
  // are at unmount, not as they were on mount.
  const isRecordingRef = React.useRef(false);
  React.useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  const writeCurrentNoteRef = React.useRef<
    ((body: string, provider?: TranscriptionProvider) => Promise<void>) | null
  >(null);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void window.ipc
        .invoke("transcription:getRouting", null)
        .then((routing) => {
          if (!cancelled) setAvailable(routing.voiceMemo.location !== "unavailable");
        })
        .catch(() => {
          if (!cancelled) setAvailable(false);
        });
    };
    refresh();
    voice.warmup();
    const onConfigChanged = () => refresh();
    window.addEventListener("transcription-config-changed", onConfigChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("transcription-config-changed", onConfigChanged);
      // Unmounting mid-recording discards the audio (voice.cancel clears the PCM
      // buffer). Without this the note stays at "*Recording in progress...*"
      // forever with no hint anything went wrong. Reached by navigating away from
      // the Knowledge view, whose copy of this button unmounts with it. The IPC
      // write is fire-and-forget but survives — it is handled in the main process.
      if (isRecordingRef.current) {
        void writeCurrentNoteRef.current?.(
          "*Recording was interrupted before it could be transcribed.*",
          "none",
        );
      }
      voice.cancel();
    };
  }, [voice.cancel, voice.warmup]);

  const noteContent = React.useCallback((body: string, provider: TranscriptionProvider) => {
    const recordedAt = recordedAtRef.current ?? new Date().toISOString();
    const relativePath = relativePathRef.current ?? "";
    const local = provider === "whisper-local";
    const unavailable = provider === "none";
    const providerLabel =
      provider === "whisper-local"
        ? "whisper.cpp"
        : provider === "solomon"
          ? "solomon-deepgram"
          : provider;
    return `---
type: voice memo
recorded: "${recordedAt}"
path: ${relativePath}
transcription_provider: ${providerLabel}
transcription_location: ${unavailable ? "unavailable" : local ? "device" : "cloud"}
audio_uploaded: ${!unavailable && !local ? "true" : "false"}
raw_audio_retained: false
---
# Voice Memo

## Transcript

${body}
`;
  }, []);

  const writeCurrentNote = React.useCallback(
    async (body: string, provider = providerRef.current) => {
      const notePath = notePathRef.current;
      if (!notePath) return;
      try {
        await window.ipc.invoke("workspace:writeFile", {
          path: notePath,
          data: noteContent(body, provider),
          opts: { encoding: "utf8", mkdirp: true },
        });
        onNoteCreatedRef.current?.(notePath);
      } catch (err) {
        console.error("Failed to update voice note:", err);
      }
    },
    [noteContent],
  );

  const startRecording = async () => {
    try {
      // Generate timestamp and paths immediately
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, "-");
      const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
      const noteName = `voice-memo-${timestamp}`;
      const notePath = `knowledge/Voice Memos/${dateStr}/${noteName}.md`;

      notePathRef.current = notePath;
      recordedAtRef.current = now.toISOString();
      // Relative path for linking (from knowledge/ root, without .md extension)
      const relativePath = `Voice Memos/${dateStr}/${noteName}`;
      relativePathRef.current = relativePath;

      // Create the note immediately with a "Recording..." placeholder
      await window.ipc.invoke("workspace:mkdir", {
        path: `knowledge/Voice Memos/${dateStr}`,
        recursive: true,
      });

      // Resolve and open the same provider path push-to-talk uses. A selected cloud
      // provider is allowed to receive audio; local-only mode resolves to Whisper (or
      // unavailable) before the microphone opens.
      const { provider, started } = await voice.start();
      providerRef.current = provider;
      if (!started) {
        await writeCurrentNote(
          provider === "none"
            ? "*Transcription is unavailable. Install an on-device model or allow a cloud provider in Settings → Transcription.*"
            : "*Recording could not start. Check microphone access and try again.*",
          "none",
        );
        toast(
          provider === "none"
            ? "Voice transcription is unavailable"
            : "Could not access microphone",
          "error",
        );
        return;
      }

      await window.ipc.invoke("workspace:writeFile", {
        path: notePath,
        data: noteContent("*Recording in progress...*", provider),
        opts: { encoding: "utf8" },
      });

      // Select the note so the user can see it
      onNoteCreatedRef.current?.(notePath);
      setIsRecording(true);
      toast("Recording started", "success");
    } catch (err) {
      voice.cancel();
      console.error("Could not start voice note:", err);
      toast("Could not access microphone", "error");
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    await writeCurrentNote("*Transcribing...*");
    const transcript = await voice.submit();
    if (transcript) {
      await writeCurrentNote(transcript);
      toast("Voice note transcribed", "success");
    } else {
      await writeCurrentNote("*Transcription failed. Please try again.*");
      toast("Transcription failed", "error");
    }
  };

  // Publish the live recording handle so the collapsed rail's status pill can
  // show it and stop it while this button is hidden. The published closure reads
  // stopRecordingRef at click time, so it never calls a stale handler; the
  // unmount clear stops one outliving this button.
  React.useEffect(() => {
    stopRecordingRef.current = stopRecording;
    writeCurrentNoteRef.current = writeCurrentNote;
  });
  React.useEffect(() => {
    if (isRecording) {
      // stoppingRef makes the published handler idempotent. The button guards
      // re-entry with `disabled` once voice.state flips to "transcribing", but
      // that lags a frame — without this, a double-click on the pill submits
      // twice and the second (empty) submit overwrites the transcript with a
      // failure message.
      stoppingRef.current = false;
      onRecordingChangeRef.current?.({
        phase: "recording",
        stop: () => {
          if (stoppingRef.current) return;
          stoppingRef.current = true;
          void stopRecordingRef.current?.();
        },
      });
      return;
    }
    // Transcription runs for seconds after the audio stops. Keep publishing so
    // the rail keeps showing the voice note is still working, with no stop
    // handler — there is nothing left to cancel at that point.
    onRecordingChangeRef.current?.(isTranscribing ? { phase: "transcribing" } : null);
  }, [isRecording, isTranscribing]);
  React.useEffect(() => () => onRecordingChangeRef.current?.(null), []);

  if (!available) return null;

  const actionClass =
    "flex h-9 min-w-0 flex-1 items-center justify-center rounded-none border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors";
  const iconClass =
    "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-none p-1.5 transition-colors";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void (isRecording ? stopRecording() : startRecording())}
          disabled={voice.state === "transcribing"}
          className={variant === "action" ? actionClass : iconClass}
          aria-label={
            voice.state === "transcribing"
              ? "Transcribing voice note"
              : isRecording
                ? "Stop recording"
                : "New voice note"
          }
        >
          {isRecording || voice.state === "transcribing" ? (
            <Square className="size-4 fill-red-500 text-red-500 animate-pulse" />
          ) : (
            <Mic className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {voice.state === "transcribing"
          ? "Transcribing…"
          : isRecording
            ? "Stop Recording"
            : "New Voice Note"}
      </TooltipContent>
    </Tooltip>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Mic;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex h-9 min-w-0 flex-1 items-center justify-center rounded-none border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

type UpcomingMeeting = {
  id: string;
  summary: string;
  start: Date;
  isAllDay: boolean;
  location: string | null;
  htmlLink: string | null;
  conferenceLink: string | null;
  source: string;
  rawStart: { dateTime?: string; date?: string } | undefined;
  rawEnd: { dateTime?: string; date?: string } | undefined;
};

type RawCalendarEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
  status?: string;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

function parseAllDayDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function normalizeUpcomingMeeting(
  raw: RawCalendarEvent,
  sourcePath: string,
): UpcomingMeeting | null {
  if (raw.status === "cancelled") return null;
  const declined = raw.attendees?.find((a) => a.self)?.responseStatus === "declined";
  if (declined) return null;
  const allDayStart = raw.start?.date;
  const timedStart = raw.start?.dateTime;
  const isAllDay = !timedStart && Boolean(allDayStart);
  let start: Date | null = null;
  let end: Date | null = null;
  if (timedStart) {
    start = new Date(timedStart);
    end = raw.end?.dateTime ? new Date(raw.end.dateTime) : null;
  } else if (allDayStart) {
    start = parseAllDayDate(allDayStart);
    end = raw.end?.date ? parseAllDayDate(raw.end.date) : null;
  }
  if (!start || Number.isNaN(start.getTime())) return null;
  const now = new Date();
  const effectiveEnd = end ?? (isAllDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : start);
  if (effectiveEnd <= now) return null;
  const conferenceLink = extractConferenceLink(raw as unknown as Record<string, unknown>) ?? null;
  return {
    id: raw.id ?? sourcePath,
    summary: raw.summary?.trim() || "(No title)",
    start,
    isAllDay,
    location: raw.location?.trim() || null,
    htmlLink: raw.htmlLink ?? null,
    conferenceLink,
    source: sourcePath,
    rawStart: raw.start,
    rawEnd: raw.end,
  };
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMeetingTime(event: UpcomingMeeting): string {
  if (event.isAllDay) return "All day";
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = event.start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (isSameLocalDay(event.start, now)) return time;
  if (isSameLocalDay(event.start, tomorrow)) return `Tmrw ${time}`;
  return event.start.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
  });
}

function triggerMeetingCapture(event: UpcomingMeeting, openConference: boolean) {
  window.__pendingCalendarEvent = {
    summary: event.summary,
    start: event.rawStart,
    end: event.rawEnd,
    location: event.location ?? undefined,
    htmlLink: event.htmlLink ?? undefined,
    conferenceLink: event.conferenceLink ?? undefined,
    source: event.source,
  };
  if (openConference && event.conferenceLink) {
    window.open(event.conferenceLink, "_blank");
  }
  window.dispatchEvent(new Event("calendar-block:join-meeting"));
}

type SidebarEmailThread = {
  threadId: string;
  subject: string;
  from: string;
  date: string;
};

function formatEmailFrom(from: string): string {
  const match = /^\s*"?([^"<]+?)"?\s*<.+>\s*$/.exec(from);
  if (match) return match[1].trim();
  return from;
}
