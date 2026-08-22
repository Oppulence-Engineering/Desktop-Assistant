import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  AlertTriangle,
  Workflow,
  Calendar,
  Clock,
  FileText,
  Mail,
  MessageSquare,
  Mic,
  Plug,
  Plus,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Video,
} from "@/lib/icons";
import type { Relationship, RelationshipAttentionItem } from "@x/shared/relationships";
import { extractConferenceLink } from "@/lib/calendar-event";
import { emitRendererEvent } from "@/lib/renderer-events";
import { SettingsDialog } from "@/components/settings-dialog";
import { HUBSPOT_BRAND_ICON, WISPR_FLOW_BRAND_ICON } from "@/components/onboarding/brand-icons";

interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: TreeNode[];
  stat?: { size: number; mtimeMs: number };
}

type RunItem = { id: string; title?: string; createdAt: string };
type TaskItem = {
  slug: string;
  name: string;
  active: boolean;
  lastRunAt?: string;
  lastAttemptAt?: string;
};

type HomeViewProps = {
  tree: TreeNode[];
  runs: RunItem[];
  bgTaskSummaries: TaskItem[];
  onOpenEmail: () => void;
  onOpenMeetings: () => void;
  onOpenAgents: () => void;
  onOpenAgent: (slug: string) => void;
  onOpenNote: (path: string) => void;
  onOpenRun: (runId: string) => void;
  onTakeMeetingNotes: () => void;
  onOpenChat?: () => void;
  onOpenRelationships?: (relationshipId?: string) => void;
};

type CalEvent = {
  id: string;
  summary: string;
  start: Date;
  end: Date | null;
  isAllDay: boolean;
  conferenceLink: string | null;
  rawStart: { dateTime?: string; date?: string } | undefined;
  rawEnd: { dateTime?: string; date?: string } | undefined;
  location: string | null;
  htmlLink: string | null;
  source: string;
};

type RawCalEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
  status?: string;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
};

type EmailThread = { threadId: string; subject: string; from: string };
type ToolkitPreview = {
  slug: string;
  name: string;
  description: string;
  connected: boolean;
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function timeOfDay(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relativeFromNow(start: Date): string {
  const ms = start.getTime() - Date.now();
  if (ms <= 0) return "now";
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr}h`;
  return start.toLocaleDateString([], { weekday: "short" });
}

function relativeAgo(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function parseAllDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function normalizeCalEvent(raw: RawCalEvent, sourcePath: string): CalEvent | null {
  if (raw.status === "cancelled") return null;
  const declined = raw.attendees?.find((a) => a.self)?.responseStatus === "declined";
  if (declined) return null;
  const timed = raw.start?.dateTime;
  const allDay = raw.start?.date;
  const isAllDay = !timed && Boolean(allDay);
  let start: Date | null = null;
  let end: Date | null = null;
  if (timed) {
    start = new Date(timed);
    end = raw.end?.dateTime ? new Date(raw.end.dateTime) : null;
  } else if (allDay) {
    start = parseAllDay(allDay);
    end = raw.end?.date ? parseAllDay(raw.end.date) : null;
  }
  if (!start || Number.isNaN(start.getTime())) return null;
  return {
    id: raw.id ?? sourcePath,
    summary: raw.summary?.trim() || "(No title)",
    start,
    end,
    isAllDay,
    conferenceLink: extractConferenceLink(raw as unknown as Record<string, unknown>) ?? null,
    rawStart: raw.start,
    rawEnd: raw.end,
    location: raw.location?.trim() || null,
    htmlLink: raw.htmlLink ?? null,
    source: sourcePath,
  };
}

function noteLabel(node: TreeNode): string {
  if (node.kind === "file" && node.name.toLowerCase().endsWith(".md"))
    return node.name.slice(0, -3);
  return node.name;
}

function triggerMeetingCapture(event: CalEvent, openConference: boolean) {
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
  emitRendererEvent("calendar-block:join-meeting");
}

const CARD = "rowboat-dev-card p-4";
const TOOLKIT_PREVIEW_LIMIT = 8;

let cachedToolkitPreviews: ToolkitPreview[] | null = null;
let cachedToolkitLogosLoaded = false;

function ToolkitPreviewIcon({ toolkit }: { toolkit: ToolkitPreview }) {
  const normalized = toolkit.slug.toLowerCase();
  const brandIcon = normalized.includes("hubspot")
    ? HUBSPOT_BRAND_ICON
    : normalized.includes("wispr")
      ? WISPR_FLOW_BRAND_ICON
      : null;
  return (
    <div
      title={`${toolkit.name}: ${toolkit.description}`}
      aria-label={toolkit.name}
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${
        toolkit.connected
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
          : "border-border bg-muted/60 text-muted-foreground"
      }`}
    >
      {brandIcon ? (
        <img src={brandIcon} alt="" aria-hidden="true" className="size-5 object-contain" />
      ) : (
        <Plug className="size-5" aria-hidden="true" />
      )}
    </div>
  );
}

export function HomeView({
  tree,
  runs,
  bgTaskSummaries,
  onOpenEmail,
  onOpenMeetings,
  onOpenAgents,
  onOpenAgent,
  onOpenNote,
  onOpenRun,
  onTakeMeetingNotes,
  onOpenChat,
  onOpenRelationships,
}: HomeViewProps) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [emails, setEmails] = useState<EmailThread[]>([]);
  // True unread count, tracked separately from the 3-item preview. (ERRORS.md E28)
  const [unreadCount, setUnreadCount] = useState(0);
  const [toolkitPreviews, setToolkitPreviews] = useState<ToolkitPreview[]>(
    cachedToolkitPreviews ?? [],
  );
  const [toolkitLogosLoaded, setToolkitLogosLoaded] = useState(cachedToolkitLogosLoaded);
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [attentionItems, setAttentionItems] = useState<RelationshipAttentionItem[]>([]);

  const loadRelationshipPulse = useCallback(async () => {
    try {
      const [relationshipResult, attentionResult] = await Promise.all([
        window.ipc.invoke("relationships:list", {}),
        window.ipc.invoke("relationships:listAttention", { status: "open" }),
      ]);
      setRelationships(relationshipResult.relationships ?? []);
      setAttentionItems(attentionResult.items ?? []);
    } catch (err) {
      // Home should remain useful when relationship services are unavailable.
      console.error("Home: failed to load relationship pulse", err);
      setRelationships([]);
      setAttentionItems([]);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const exists = await window.ipc.invoke("workspace:exists", {
        path: "calendar_sync",
      });
      if (!exists.exists) {
        setEvents([]);
        return;
      }
      const entries = await window.ipc.invoke("workspace:readdir", {
        path: "calendar_sync",
        opts: { recursive: false, includeHidden: false, includeStats: false },
      });
      const jsonEntries = entries.filter((e) => e.kind === "file" && e.name.endsWith(".json"));
      const settled = await Promise.allSettled(
        jsonEntries.map(async (entry): Promise<CalEvent | null> => {
          const result = await window.ipc.invoke("workspace:readFile", {
            path: entry.path,
            encoding: "utf8",
          });
          return normalizeCalEvent(JSON.parse(result.data) as RawCalEvent, entry.path);
        }),
      );
      const out: CalEvent[] = [];
      for (const r of settled) if (r.status === "fulfilled" && r.value) out.push(r.value);
      out.sort((a, b) => a.start.getTime() - b.start.getTime());
      setEvents(out);
    } catch (err) {
      console.error("Home: failed to load events", err);
    }
  }, []);

  const loadEmails = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("gmail:getImportant", {
        limit: 25,
      });
      const unread = result.threads.filter((t) => t.unread === true);
      setUnreadCount(unread.length);
      setEmails(
        unread.slice(0, 3).map((t) => ({
          threadId: t.threadId,
          subject: t.subject ?? "(No subject)",
          from: t.from ?? "",
        })),
      );
    } catch (err) {
      console.error("Home: failed to load emails", err);
    }
  }, []);

  const loadConnectorLogos = useCallback(async () => {
    if (cachedToolkitLogosLoaded) return;
    try {
      const result = await window.ipc.invoke("connectors:list", null);
      const previews = (result.connectors || [])
        .slice(0, TOOLKIT_PREVIEW_LIMIT)
        .map((connector) => ({
          slug: connector.name,
          name: connector.displayName,
          description: connector.description,
          connected: connector.connected,
        }));
      cachedToolkitPreviews = previews;
      setToolkitPreviews(previews);
    } catch {
      cachedToolkitPreviews = [];
    } finally {
      cachedToolkitLogosLoaded = true;
      setToolkitLogosLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
    void loadEmails();
    void loadConnectorLogos();
    void loadRelationshipPulse();
  }, [loadEvents, loadEmails, loadConnectorLogos, loadRelationshipPulse]);

  // Upcoming (not-yet-ended) events, soonest first.
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => {
      const end = e.end ?? (e.isAllDay ? new Date(e.start.getTime() + 864e5) : e.start);
      return end.getTime() > now;
    });
  }, [events]);

  const nextEvent = upcoming[0];

  const relationshipPreview = useMemo(() => relationships.slice(0, 3), [relationships]);
  const customerAttention = useMemo(
    () => attentionItems.filter((item) => item.reasonCode !== "source_degradation").slice(0, 3),
    [attentionItems],
  );
  const goldenPathTarget = customerAttention[0]
    ? relationships.find((relationship) => relationship.id === customerAttention[0].relationshipId)
    : relationshipPreview[0];

  const todaysEvents = useMemo(() => {
    const now = new Date();
    return upcoming.filter(
      (e) =>
        e.start.getFullYear() === now.getFullYear() &&
        e.start.getMonth() === now.getMonth() &&
        e.start.getDate() === now.getDate(),
    );
  }, [upcoming]);

  const activeAgents = useMemo(() => bgTaskSummaries.filter((t) => t.active), [bgTaskSummaries]);
  const recentAgent = useMemo(() => {
    const t = (s?: string) => (s ? new Date(s).getTime() || 0 : 0);
    return [...bgTaskSummaries].sort(
      (a, b) =>
        Math.max(t(b.lastRunAt), t(b.lastAttemptAt)) - Math.max(t(a.lastRunAt), t(a.lastAttemptAt)),
    )[0];
  }, [bgTaskSummaries]);

  const recentNotes = useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.path === "knowledge/Meetings" || n.path === "knowledge/Workspace") continue;
        if (n.kind === "file") out.push(n);
        else if (n.children?.length) walk(n.children);
      }
    };
    walk(tree);
    return out
      .filter((n) => n.stat?.mtimeMs)
      .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))
      .slice(0, 2);
  }, [tree]);

  const recentActivity = useMemo(() => {
    const items: Array<{
      key: string;
      icon: "note" | "chat";
      label: string;
      kind: string;
      when: number;
      open: () => void;
    }> = [];
    for (const n of recentNotes) {
      items.push({
        key: `n:${n.path}`,
        icon: "note",
        label: noteLabel(n),
        kind: "note",
        when: n.stat?.mtimeMs ?? 0,
        open: () => onOpenNote(n.path),
      });
    }
    for (const r of runs.slice(0, 4)) {
      items.push({
        key: `r:${r.id}`,
        icon: "chat",
        label: r.title || "(Untitled chat)",
        kind: "chat",
        when: new Date(r.createdAt).getTime() || 0,
        open: () => onOpenRun(r.id),
      });
    }
    return items.sort((a, b) => b.when - a.when).slice(0, 4);
  }, [recentNotes, runs, onOpenNote, onOpenRun]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto px-5 py-6 md:px-9 md:py-7">
        <div className="mx-auto flex max-w-[820px] flex-col gap-4">
          {/* Greeting */}
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight">{greeting()}</h1>
            <span className="text-sm text-muted-foreground">{todayLabel()}</span>
          </div>

          {/* Relationship-first front door */}
          <section
            className="rowboat-dev-card border-primary/20 bg-primary/[0.025] p-[18px]"
            data-capability="relationship-home mission-control"
            data-tour-target="home-accounts"
          >
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-none border border-primary/20 bg-primary/5 text-primary">
                <UsersRound className="size-[17px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Account mission control
                </div>
                <h2 className="mt-0.5 text-[17px] font-medium">What needs your attention now?</h2>
                <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                  Oppulence reconciles email, meetings, Slack, CRM, and notes into explainable
                  relationship state. Review the evidence before anything is sent or changed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenRelationships?.()}
                className="inline-flex shrink-0 items-center gap-1 rounded-none border border-border px-3 py-2 text-[12px] font-medium transition-colors hover:bg-accent"
              >
                Open accounts
                <ArrowRight className="size-3" />
              </button>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-3">
              {customerAttention.length > 0 ? (
                customerAttention.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenRelationships?.(item.relationshipId)}
                    className="border border-border bg-background/70 p-3 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-3.5 text-amber-500" />
                      <span className="truncate text-[12.5px] font-medium">
                        {item.relationshipName}
                      </span>
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                        {item.urgencyBand}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">
                      {item.explanation}
                    </p>
                  </button>
                ))
              ) : relationshipPreview.length > 0 ? (
                relationshipPreview.map((relationship) => (
                  <button
                    key={relationship.id}
                    type="button"
                    onClick={() => onOpenRelationships?.(relationship.id)}
                    className="border border-border bg-background/70 p-3 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-3.5 text-emerald-500" />
                      <span className="truncate text-[12.5px] font-medium">
                        {relationship.displayName}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">
                      {relationship.nextAction ||
                        relationship.summary ||
                        "Relationship state is current."}
                    </p>
                  </button>
                ))
              ) : (
                <div className="border border-dashed border-border p-3 text-[12px] text-muted-foreground md:col-span-3">
                  Connect a source to build your first living relationship record.
                </div>
              )}
            </div>
          </section>

          {/* Golden path: signal → evidence → impact → recommendation → approval */}
          <section
            className="rowboat-dev-card p-4"
            data-capability="relationship-golden-path"
            data-tour-target="relationship-action"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="size-[15px] text-oppulence-orange" />
              <span className="text-sm font-medium">From signal to approved action</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {goldenPathTarget?.displayName ?? "Example account"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-5">
              {[
                [
                  "01",
                  "Signal",
                  customerAttention[0]?.explanation ?? "A material change is detected",
                ],
                ["02", "Evidence", "Source-linked messages and events"],
                [
                  "03",
                  "Impact",
                  goldenPathTarget?.stateReason ?? "Relationship health is explained",
                ],
                [
                  "04",
                  "Recommendation",
                  goldenPathTarget?.nextAction ?? "Review the recommended next step",
                ],
                ["05", "Approval", "You approve before any external write"],
              ].map(([number, label, copy]) => (
                <div key={label} className="border border-border p-2.5">
                  <div className="text-[10px] font-mono text-muted-foreground">{number}</div>
                  <div className="mt-1 text-[12px] font-medium">{label}</div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{copy}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onOpenRelationships?.(goldenPathTarget?.id)}
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              Review evidence and approval
              <ArrowRight className="size-3" />
            </button>
          </section>

          {/* Up-next hero */}
          {nextEvent && (
            <div className="rowboat-dev-card flex items-center gap-[18px] p-[18px]">
              <div className="flex size-[52px] shrink-0 items-center justify-center rounded-none bg-muted text-foreground">
                <Mic className="size-[22px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Up next · {nextEvent.isAllDay ? "today" : relativeFromNow(nextEvent.start)}
                </div>
                <div className="mb-0.5 truncate text-[17px] font-medium">{nextEvent.summary}</div>
                <div className="truncate text-[13px] text-muted-foreground">
                  {nextEvent.isAllDay
                    ? "All day"
                    : `${timeOfDay(nextEvent.start)}${nextEvent.end ? ` – ${timeOfDay(nextEvent.end)}` : ""}`}
                  {nextEvent.location ? ` · ${nextEvent.location}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={onTakeMeetingNotes}
                  className="rounded-none bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Take notes
                </button>
                {nextEvent.conferenceLink && (
                  <button
                    type="button"
                    onClick={() => window.open(nextEvent.conferenceLink!, "_blank")}
                    className="rounded-none border border-border px-3 py-2 text-foreground transition-colors hover:bg-accent"
                    aria-label="Join meeting"
                  >
                    <Video className="size-[13px]" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Inbox + Background tasks */}
          <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
            <div className={CARD}>
              <div className="mb-3 flex items-center gap-2">
                <Mail className="size-[15px]" />
                <span className="text-sm font-medium">Inbox</span>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-destructive px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide text-white">
                    {unreadCount} new
                  </span>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={onOpenEmail}
                  aria-label="Open inbox"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Open
                  <ArrowRight className="size-3" />
                </button>
              </div>
              {emails.length === 0 ? (
                <div className="py-1 text-[12.5px] text-muted-foreground">
                  No unread important email.
                </div>
              ) : (
                emails.map((e, i) => (
                  <button
                    key={e.threadId}
                    type="button"
                    onClick={onOpenEmail}
                    className={`flex w-full gap-2.5 py-[7px] text-left text-[12.5px] ${i ? "border-t border-border" : ""}`}
                  >
                    <span className="w-[92px] shrink-0 truncate text-muted-foreground">
                      {formatFrom(e.from)}
                    </span>
                    <span className="flex-1 truncate">{e.subject}</span>
                  </button>
                ))
              )}
            </div>

            <div className={CARD}>
              <div className="mb-3 flex items-center gap-2">
                <Workflow className="size-[15px]" />
                <span className="text-sm font-medium">Background tasks</span>
                <span className="flex-1" />
                <span className="text-xs text-muted-foreground">{activeAgents.length} active</span>
                <button
                  type="button"
                  onClick={onOpenAgents}
                  aria-label="Open background tasks"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Open
                  <ArrowRight className="size-3" />
                </button>
              </div>
              {recentAgent ? (
                <button
                  type="button"
                  onClick={() => onOpenAgent(recentAgent.slug)}
                  className="flex w-full items-center gap-2.5 py-[7px] text-left text-[13px]"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${recentAgent.active ? "bg-emerald-500" : "bg-muted-foreground"}`}
                  />
                  <span className="flex-1 truncate font-medium">{recentAgent.name}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {relativeAgo(recentAgent.lastRunAt) || "—"}
                  </span>
                </button>
              ) : (
                <div className="py-1 text-[12.5px] text-muted-foreground">
                  No relationship actions yet. Create one to keep a follow-up or risk check moving.
                </div>
              )}
              <button
                type="button"
                onClick={onOpenAgents}
                className="mt-3.5 flex items-center gap-2 border-t border-border pt-3 text-[12.5px] font-medium text-primary"
              >
                <Plus className="size-3" />
                Create a task
              </button>
            </div>
          </div>

          {/* Today's schedule */}
          <div className={CARD}>
            <div className="mb-3.5 flex items-center gap-2">
              <Calendar className="size-[14px]" />
              <span className="text-sm font-medium">Today's schedule</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onOpenMeetings}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                All meetings
                <ArrowRight className="size-3" />
              </button>
            </div>
            {todaysEvents.length === 0 ? (
              <div className="py-1 text-[13px] italic text-muted-foreground">
                No more events today.
              </div>
            ) : (
              todaysEvents.map((e, i) => (
                <div
                  key={e.id}
                  className={`group flex items-center gap-3.5 py-2 text-[13px] ${i ? "border-t border-border" : ""}`}
                >
                  <span className="w-[90px] shrink-0 font-mono text-[11.5px] text-muted-foreground">
                    {e.isAllDay
                      ? "All day"
                      : `${timeOfDay(e.start)}${e.end ? ` – ${timeOfDay(e.end)}` : ""}`}
                  </span>
                  <span
                    className={`size-2 shrink-0 rounded-full ${i === 0 ? "bg-emerald-500" : "bg-border"}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{e.summary}</span>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => triggerMeetingCapture(e, false)}
                      className="inline-flex items-center gap-1 rounded-none border border-border px-2 py-1 text-[11.5px] text-foreground transition-colors hover:bg-accent"
                    >
                      <Mic className="size-3" />
                      Take notes
                    </button>
                    {e.conferenceLink && (
                      <button
                        type="button"
                        onClick={() => triggerMeetingCapture(e, true)}
                        className="inline-flex items-center gap-1 rounded-none border border-border px-2 py-1 text-[11.5px] text-foreground transition-colors hover:bg-accent"
                      >
                        <Video className="size-3" />
                        Join &amp; take notes
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Recent activity */}
          {recentActivity.length > 0 && (
            <div className={CARD}>
              <div className="mb-3 flex items-center gap-2">
                <Clock className="size-[14px]" />
                <span className="text-sm font-medium">Recent activity</span>
              </div>
              {recentActivity.map((a, i) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={a.open}
                  className={`flex w-full items-center gap-3 py-2 text-left text-[13px] ${i ? "border-t border-border" : ""}`}
                >
                  {a.icon === "note" ? (
                    <FileText className="size-[13px] shrink-0 text-muted-foreground" />
                  ) : (
                    <MessageSquare className="size-[13px] shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">{a.label}</span>
                  <span className="w-[60px] text-right text-[11px] text-muted-foreground">
                    {a.kind}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Tool connections */}
          <div className={CARD} data-tour-target="tools">
            <div className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-none border border-border bg-muted text-muted-foreground">
                <Plug className="size-[14px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] leading-snug">
                  <span className="font-medium">Connect your tools.</span>
                  <span className="text-muted-foreground">
                    {" "}
                    Bring context from the apps you already use.
                  </span>
                </div>
                <div className="mt-3 flex min-h-5 flex-wrap items-center gap-1.5">
                  {toolkitLogosLoaded &&
                    toolkitPreviews.map((toolkit) => (
                      <ToolkitPreviewIcon key={toolkit.slug} toolkit={toolkit} />
                    ))}
                  <button
                    type="button"
                    onClick={() => setConnectionsSettingsOpen(true)}
                    className="ml-1 flex h-5 shrink-0 items-center gap-1 rounded-md px-1 text-[12px] font-medium text-primary hover:underline"
                  >
                    Connections
                    <ArrowRight className="size-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <SettingsDialog
            defaultTab="connections"
            open={connectionsSettingsOpen}
            onOpenChange={setConnectionsSettingsOpen}
          />

          {/* Open chat CTA */}
          {onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              className="rowboat-dev-card flex items-center gap-3.5 p-4 text-left transition-colors hover:bg-accent"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-none border border-border bg-card text-muted-foreground">
                <MessageSquare className="size-[15px]" />
              </div>
              <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
                <span className="font-medium">Resolve relationship work</span>
                <span className="text-muted-foreground">
                  {" "}
                  with evidence, drafts, research, and connected tools.
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-primary">
                New chat
                <ArrowRight className="size-3.5" />
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatFrom(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<.+>\s*$/.exec(from);
  return (m ? m[1] : from).trim();
}
