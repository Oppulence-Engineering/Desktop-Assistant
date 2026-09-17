"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  AddressBook,
  Bell,
  Brain,
  CaretRight,
  CaretUpDown,
  CheckCircle,
  Clock,
  Folder,
  GearSix,
  Monitor,
  Moon,
  Palette,
  Plugs,
  Plus,
  Question,
  Rocket,
  ShieldCheck,
  SidebarSimple,
  SignOut,
  Stack,
  Sun,
  Wallet,
  WarningCircle,
  X,
  type Icon as PhosphorIcon,
} from "@/lib/icons";

import { Avatar, AvatarFallback, AvatarImage } from "@oppulence/ui/components/avatar";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Label } from "@oppulence/ui/components/label";
import { Progress } from "@oppulence/ui/components/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@oppulence/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@oppulence/ui/components/dropdown-menu";
import { dashboardFetch } from "@/lib/auth/client";
import { isOptionalDashboardFailure } from "@/lib/dashboard-json";
import { getPref, setPref, usePref } from "@/lib/console-prefs";
import {
  listRelationshipSourceStatuses,
  RELATIONSHIP_SOURCE_STATUS_QUERY_KEY,
} from "@/lib/revenue";
import { loadChangelog, type ChangelogEntry } from "@/lib/api/changelog/changelog";
import type { ResourceKind } from "@/lib/dashboard-resource";
import {
  REVENUE_TAB_LABELS,
  revenueTabFromParam,
  revenueTabSearch,
  type ProductView,
  type RevenueTab,
  type SettingsSection,
} from "@/lib/product-navigation";
import type { RelationshipSourceStatus } from "@/types/revenue";
import { cn } from "@/lib/utils";

export {
  REVENUE_TAB_LABELS,
  revenueTabFromParam,
  revenueTabSearch,
  type RevenueTab,
  type SettingsSection,
};
export type { ResourceKind } from "@/lib/dashboard-resource";

export type SettingsGroup = "workspace" | "global" | "cloud" | "support";

export const SETTINGS_SECTIONS: {
  key: SettingsSection;
  label: string;
  icon: PhosphorIcon;
  group?: SettingsGroup;
  description: string;
  beta?: boolean;
}[] = [
  {
    key: "overview",
    label: "Settings",
    icon: GearSix,
    description: "Everything that shapes your workspace and account.",
  },
  {
    key: "preferences",
    label: "Preferences",
    icon: Clock,
    group: "workspace",
    description: "Default agent, reasoning, notifications, privacy, and memory.",
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: Bell,
    group: "workspace",
    description: "Configure browser and relationship notification preferences.",
  },
  {
    key: "permissions",
    label: "Permissions",
    icon: AddressBook,
    group: "workspace",
    description: "Control identity, access, and authorized workspace resources.",
  },
  {
    key: "security",
    label: "Security",
    icon: ShieldCheck,
    group: "workspace",
    description: "Review session security and authorized evidence access.",
  },
  {
    key: "connections",
    label: "Connections",
    icon: Plugs,
    group: "workspace",
    description: "Manage connected accounts and available tools.",
  },
  {
    key: "advanced",
    label: "Advanced",
    icon: Rocket,
    group: "workspace",
    description: "Inspect endpoints, diagnostics, and advanced workspace controls.",
  },
  {
    key: "customization",
    label: "Customization",
    icon: Folder,
    group: "global",
    description: "Tune product branding, navigation, and workspace layout.",
  },
  {
    key: "appearance",
    label: "Appearance",
    icon: Palette,
    group: "global",
    description: "Set theme, language, and window preferences.",
  },
  {
    key: "account",
    label: "Account",
    icon: Wallet,
    group: "cloud",
    description: "Manage your identity, organization, plan, and active session.",
  },
  {
    key: "connect",
    label: "Oppulence Connect",
    icon: Plus,
    group: "cloud",
    description: "Manage organization-approved, shared cloud connections.",
    beta: true,
  },
  {
    key: "help",
    label: "Help",
    icon: Question,
    group: "support",
    description: "Get help, report a problem, or read the documentation.",
  },
];

const SETTINGS_GROUP_LABELS: Record<SettingsGroup, string> = {
  workspace: "Workspace",
  global: "Global",
  cloud: "Cloud",
  support: "Support",
};

export type ThemePreference = "light" | "dark" | "system";

export function useThemePreference() {
  const [theme, setTheme] = React.useState<ThemePreference>("system");

  const applyTheme = React.useCallback((value: ThemePreference) => {
    const resolved =
      value === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : value;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    localStorage.setItem("theme", value);
  }, []);

  React.useEffect(() => {
    const saved = (localStorage.getItem("theme") as ThemePreference) || "system";
    setTheme(saved);
    applyTheme(saved);
  }, [applyTheme]);

  React.useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme, applyTheme]);

  const handleTheme = React.useCallback(
    (value: ThemePreference) => {
      setTheme(value);
      applyTheme(value);
    },
    [applyTheme],
  );

  return { theme, setTheme: handleTheme };
}

type SidebarSelect = (item: { kind: ResourceKind; name: string }) => void;

type ShellUser = {
  name: string;
  email: string;
};

/** The billing facts the shell renders: the plan badge and the trial banner. */
export type ShellBilling = {
  plan?: string | null;
  status?: string | null;
  trialExpiresAt?: string | null;
};

/**
 * The single workspace is the account itself. We do not model named
 * organizations, so the switcher is labelled with the person rather than an
 * invented org name; an email is trimmed to its local part to read as a name.
 */
export function useWorkspaceLabel(user: { name: string; email: string }) {
  const displayName = usePref("display-name") || user.name;
  const label = displayName.includes("@") ? displayName.split("@")[0] : displayName;
  return label || "Workspace";
}

/** Whole days left on a trial, or null when the account is not trialing. */
export function trialDaysRemaining(billing?: ShellBilling) {
  if (billing?.status !== "trialing" || !billing.trialExpiresAt) return null;
  const remaining = new Date(billing.trialExpiresAt).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return null;
  return Math.max(0, Math.ceil(remaining / 86_400_000));
}

/* ------------------------------- view boundary ----------------------------- */

/**
 * Keeps one view's crash inside the content pane.
 *
 * Without this the nearest boundary is the route's, so a single undefined
 * field in any tab replaced the whole workspace — sidebar included — with
 * "The workspace could not be loaded", leaving no way to navigate off the
 * broken view.
 */
export class ViewBoundary extends React.Component<
  { children: React.ReactNode; viewKey: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { viewKey: string }) {
    // Moving to another view clears the failure; the next one deserves a try.
    if (previous.viewKey !== this.props.viewKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: unknown) {
    console.error("View crashed", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-1 items-center justify-center p-8" role="alert">
        <div className="max-w-sm text-center">
          <WarningCircle className="mx-auto size-6 text-destructive" />
          <p className="mt-3 text-sm font-medium text-primary">This view could not be shown</p>
          <p className="mt-1 text-[13px] text-primary/55">
            The rest of the workspace still works. Open another view, or try this one again.
          </p>
          <Button
            className="mt-4 h-8 px-3 text-[13px]"
            onClick={() => this.setState({ failed: false })}
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
}

/* --------------------------------- top bar --------------------------------- */

const CHANGELOG_SEEN_PREF = "sidebar-changelog-seen";

/**
 * The newest release as one line next to the logo. It carries a version the
 * user can check against the release notes, so it is hidden entirely when the
 * feed is empty or unreachable — an announcement we cannot source is worse
 * than none.
 */
function ShellReleasePill() {
  const [entry, setEntry] = React.useState<ChangelogEntry | null>(null);
  // The shell only ever renders on the client (AuthGate holds the tree until
  // the session resolves), so reading the pref during render cannot desync
  // hydration and a dismissed note never flashes.
  const [seen, setSeen] = React.useState(() => getPref(CHANGELOG_SEEN_PREF));

  React.useEffect(() => {
    let cancelled = false;
    loadChangelog()
      .then((loaded) => {
        if (!cancelled) setEntry(loaded[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Dismissal is per release: the note returns on its own when the next one
  // ships, so nobody has to remember to re-enable it.
  if (!entry || seen === entry.version) return null;
  return (
    <div className="hidden min-w-0 items-center gap-1.5 md:flex">
      <a
        className="flex min-w-0 items-center gap-2 text-primary/75 transition-colors hover:text-primary"
        href={entry.url}
        rel="noopener noreferrer"
        target="_blank"
      >
        <Badge
          className="shrink-0 bg-background-200 font-mono text-[11px] font-medium text-primary/80"
          variant="secondary"
        >
          {entry.version}
        </Badge>
        <Label className="truncate font-mono text-[13px] font-normal">{entry.title}</Label>
      </a>
      <Button
        aria-label="Dismiss release note"
        className="size-6 shrink-0 text-primary/40 hover:text-primary"
        onClick={() => {
          setPref(CHANGELOG_SEEN_PREF, entry.version);
          setSeen(entry.version);
        }}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

/** Opens the support chat when it booted; otherwise the link still sends an email. */
function FeedbackLink({ className }: { className?: string }) {
  return (
    <a
      className={className}
      href="mailto:hello@oppulence.io"
      onClick={(event) => {
        const plain = window.Plain;
        if (plain?.isInitialized?.() && plain.open) {
          event.preventDefault();
          plain.open();
        }
      }}
    >
      Feedback?
    </a>
  );
}

const TOP_BAR_LINK =
  "text-[14px] text-primary/75 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30";

/** The full-width bar above the framed workspace: brand, latest release, shortcuts. */
export function AppTopBar({
  onAsk,
  onOpenPeople,
}: {
  onAsk: () => void;
  onOpenPeople: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 px-4 md:px-6">
      <Avatar aria-hidden="true" className="size-6 rounded-none" size="sm">
        <AvatarImage
          alt=""
          className="scale-[1.85] object-contain dark:invert"
          src="/marketing/oppulence-icon.png"
        />
        <AvatarFallback className="rounded-none" />
      </Avatar>
      <ShellReleasePill />
      <nav aria-label="Shortcuts" className="ml-auto flex shrink-0 items-center gap-6">
        <Button
          className={TOP_BAR_LINK}
          onClick={onAsk}
          title="Command palette"
          type="button"
          variant="ghost"
        >
          Ask Oppulence
        </Button>
        <Button
          className={cn(TOP_BAR_LINK, "hidden h-auto px-0 py-0 sm:inline")}
          onClick={onOpenPeople}
          type="button"
          variant="ghost"
        >
          People
        </Button>
        <FeedbackLink className={cn(TOP_BAR_LINK, "hidden sm:inline")} />
      </nav>
    </header>
  );
}

/* ------------------------------ sidebar footer ----------------------------- */

export type SourceHealth = { tone: "ok" | "syncing" | "attention" | "idle"; label: string };

/**
 * One line for the state of the evidence sources. A source that stopped
 * reporting is the difference between "no risk" and "we cannot see the risk",
 * so a stalled or disconnected source outranks anything else here.
 */
export function sourceHealth(sources: RelationshipSourceStatus[]): SourceHealth {
  if (sources.length === 0) return { tone: "idle", label: "No sources connected" };
  const stopped = sources.filter(
    (source) => source.status === "reconnect_required" || source.status === "disconnected",
  ).length;
  if (stopped > 0) {
    return {
      tone: "attention",
      label: stopped === 1 ? "1 source needs reconnecting" : `${stopped} sources need reconnecting`,
    };
  }
  const behind = sources.filter(
    (source) => source.status === "stale" || source.completeness !== "complete",
  ).length;
  if (behind > 0) {
    return {
      tone: "attention",
      label: behind === 1 ? "1 source is behind" : `${behind} sources are behind`,
    };
  }
  if (sources.some((source) => source.status === "backfilling" || source.status === "rebuilding")) {
    return { tone: "syncing", label: "Syncing sources" };
  }
  return { tone: "ok", label: "Sources are current" };
}

const SOURCE_TONE_CARD: Record<SourceHealth["tone"], string> = {
  ok: "border-border text-primary",
  syncing: "border-oppulence-blue/60 text-oppulence-blue",
  attention: "border-oppulence-orange/60 text-oppulence-orange",
  idle: "border-oppulence-orange/60 text-oppulence-orange",
};

const STOPPED_SOURCE_STATUSES = new Set(["reconnect_required", "disconnected", "not_connected"]);

/** Sources still delivering evidence; one that needs reconnecting does not count. */
export function connectedSourceCount(sources: RelationshipSourceStatus[]) {
  return sources.filter((source) => !STOPPED_SOURCE_STATUSES.has(source.status)).length;
}

/**
 * Whether an audit can only fail: Google has accounts and every one of them
 * needs the user back through OAuth. One working account means a reconnect
 * already happened. The desktop app can record that under a different account
 * id than the one that failed, so a stale row must not block the audit.
 */
export function googleNeedsReconnect(sources: RelationshipSourceStatus[]) {
  const google = sources.filter((source) => source.source === "google");
  return (
    google.length > 0 &&
    google.every(
      (source) => source.status === "reconnect_required" || source.status === "disconnected",
    )
  );
}

/** A row of ticks, filled up to `ratio`. */
function TickMeter({ ratio }: { ratio: number }) {
  return (
    <Progress
      aria-hidden
      className="h-2 rounded-none bg-primary/15 [&>div]:rounded-none [&>div]:bg-primary/60"
      value={Math.round(ratio * 100)}
    />
  );
}

/**
 * The state of the evidence sources, and the trial countdown when there is one.
 * It stays visible when all is well: a source that stopped reporting is the
 * difference between "no risk" and "we cannot see the risk".
 */
function SidebarStatusCard({ billing, onOpen }: { billing?: ShellBilling; onOpen?: () => void }) {
  // A shared query, not a one-time load: this card used to keep saying "No
  // sources connected" after an audit had just marked Google for reconnecting.
  const sources = useQuery({
    queryKey: RELATIONSHIP_SOURCE_STATUS_QUERY_KEY,
    queryFn: listRelationshipSourceStatuses,
  });

  const trialDaysLeft = trialDaysRemaining(billing);
  if (sources.isPending) return null;
  const health: SourceHealth = sources.isError
    ? { tone: "idle", label: "Source status unavailable" }
    : sourceHealth(sources.data);
  const connected = sources.isError ? undefined : connectedSourceCount(sources.data);
  const total = sources.isError ? undefined : sources.data.length;
  return (
    <Button
      className={cn(
        "mb-2 h-auto w-full flex-col items-start gap-2.5 border border-dashed bg-transparent px-4 py-3 text-left hover:bg-background-100 dark:hover:bg-background-200",
        SOURCE_TONE_CARD[health.tone],
      )}
      onClick={onOpen}
      type="button"
      variant="ghost"
    >
      <Label className="text-[15px] font-normal">{health.label}</Label>
      {typeof total === "number" && typeof connected === "number" ? (
        <div className="flex w-full flex-col gap-1.5">
          <div className="flex items-center justify-between text-[13px]">
            <Label className="font-normal text-primary">Sources connected</Label>
            <Badge className="font-normal text-primary/60" variant="secondary">
              {connected} / {total}
            </Badge>
          </div>
          <TickMeter ratio={total > 0 ? connected / total : 0} />
        </div>
      ) : null}
      {trialDaysLeft === null ? null : (
        <div className="flex items-center justify-between text-[13px]">
          <Label className="font-normal text-primary">Trial</Label>
          <Badge className="font-normal text-primary/60" variant="secondary">
            {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left
          </Badge>
        </div>
      )}
    </Button>
  );
}

/* --------------------------------- sidebar --------------------------------- */

function SidebarNavItem({
  label,
  count,
  active,
  chevron,
  chevronOpen,
  href,
  className,
  onClick,
  disabled,
}: {
  label: string;
  count?: number;
  active?: boolean;
  chevron?: boolean;
  chevronOpen?: boolean;
  href?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
}) {
  const classes = cn(
    "group/item flex h-9 w-full shrink-0 items-center justify-start gap-2 rounded-none px-3.5 text-left text-[15px] text-primary/70 transition-colors hover:bg-background-100 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 dark:hover:bg-background-200",
    active && "bg-background-100 text-primary dark:bg-background-200",
    className,
  );
  const content = (
    <>
      <Label className="truncate font-normal">{label}</Label>
      {typeof count === "number" && count > 0 ? (
        <Badge className="ml-auto font-normal text-primary/40" variant="secondary">
          {count}
        </Badge>
      ) : null}
      {chevron ? (
        <CaretRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-primary/40 transition-transform",
            typeof count === "number" && count > 0 ? "" : "ml-auto",
            chevronOpen && "rotate-90",
          )}
        />
      ) : null}
    </>
  );
  if (href) {
    return (
      <Button asChild className={classes} variant="ghost">
        <Link aria-current={active ? "page" : undefined} href={href}>
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Button className={classes} disabled={disabled} onClick={onClick} type="button" variant="ghost">
      {content}
    </Button>
  );
}

function SidebarSubItem({
  label,
  active,
  muted,
  onClick,
}: {
  label: string;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      className={cn(
        "h-9 w-full justify-start gap-2.5 rounded-none py-1 pr-3 pl-6 text-left text-[14px] font-normal text-primary/65 hover:bg-background-100 hover:text-primary dark:hover:bg-background-200",
        active && "bg-background-100 text-primary dark:bg-background-200",
        muted && "text-primary/50",
      )}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <Badge
        className={cn(
          "size-1 shrink-0 rounded-none border-0 p-0 bg-primary/30",
          active && "bg-oppulence-orange",
        )}
        variant="outline"
      />
      <Label className="truncate font-normal">{label}</Label>
    </Button>
  );
}

function SidebarEmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-1.5 text-[13px] text-muted-foreground">{children}</div>;
}

const SIDEBAR_FOOTER_LINK =
  "flex h-9 w-full shrink-0 items-center justify-start rounded-none px-3.5 text-[15px] text-primary/70 transition-colors hover:bg-background-100 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 dark:hover:bg-background-200";

function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="block px-3.5 pb-1 pt-3 text-[12px] font-normal text-primary/40">
      {children}
    </Label>
  );
}

export type SidebarSessionMeta = {
  runId: string;
  title: string;
};

export function AppShellSidebar({
  open,
  onToggle,
  user,
  billing,
  selected,
  onSelectResource,
  onNavigateChat,
  onNavigateReport,
  onNavigateRevenue,
  onNavigateAgents,
  onNavigateScheduled,
  onNavigateRuns,
  activeRevenueTab = "commitments",
  activeResourceGroup,
  view = "chat",
  settingsSection = "overview",
  onOpenSettings,
  onCloseSettings,
  sessions = [],
  activeRunId = null,
  onOpenSession,
  onNewChat,
}: {
  open: boolean;
  onToggle: () => void;
  user: ShellUser;
  billing?: ShellBilling;
  selected: { kind: ResourceKind; name: string } | null;
  onSelectResource?: SidebarSelect;
  onNavigateChat?: () => void;
  onNavigateReport?: () => void;
  onNavigateRevenue?: (tab: RevenueTab) => void;
  onNavigateAgents?: () => void;
  onNavigateScheduled?: () => void;
  onNavigateRuns?: () => void;
  activeRevenueTab?: RevenueTab;
  activeResourceGroup?: "agents" | "scheduled" | "runs";
  view?: ProductView;
  settingsSection?: SettingsSection;
  onOpenSettings?: (section: SettingsSection) => void;
  onCloseSettings?: () => void;
  sessions?: SidebarSessionMeta[];
  activeRunId?: string | null;
  onOpenSession?: (runId: string) => void;
  onNewChat?: () => void;
}) {
  const [agents, setAgents] = React.useState<string[]>([]);
  const [tasks, setTasks] = React.useState<{ label: string; value: string }[]>([]);
  const [taskRuns, setTaskRuns] = React.useState<{ label: string; value: string }[]>([]);
  const [loadingGroups, setLoadingGroups] = React.useState({
    agents: true,
    scheduled: true,
    runs: true,
  });
  const [groupErrors, setGroupErrors] = React.useState<Partial<Record<string, string>>>({});
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const { theme, setTheme: handleTheme } = useThemePreference();

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await dashboardFetch("/api/rowboat/v1/agents");
        if (isOptionalDashboardFailure(res.status)) return;
        if (!res.ok) throw new Error(`Could not load agents (${res.status})`);
        const data = await res.json();
        const names = Array.isArray(data.agents)
          ? data.agents
              .map((agent: { slug?: string } | string) =>
                typeof agent === "string" ? agent : agent.slug,
              )
              .filter((agent: string | undefined): agent is string => Boolean(agent))
          : [];
        setAgents(names);
      } catch {
        setGroupErrors((current) => ({ ...current, agents: "Could not load agents" }));
      } finally {
        setLoadingGroups((current) => ({ ...current, agents: false }));
      }
    };
    load();
  }, []);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await dashboardFetch("/api/rowboat/v1/background-tasks");
        if (isOptionalDashboardFailure(res.status)) return;
        if (!res.ok) throw new Error(`Could not load schedules (${res.status})`);
        const data = await res.json();
        if (Array.isArray(data?.tasks)) {
          setTasks(
            data.tasks
              .filter((task: { slug?: string }) => typeof task?.slug === "string")
              .map((task: { slug: string; name?: string; active?: boolean }) => ({
                value: task.slug,
                label: task.name || task.slug,
              })),
          );
        }
      } catch {
        setGroupErrors((current) => ({ ...current, scheduled: "Could not load schedules" }));
      } finally {
        setLoadingGroups((current) => ({ ...current, scheduled: false }));
      }
    };
    load();
  }, []);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await dashboardFetch("/api/rowboat/v1/background-task-runs");
        if (isOptionalDashboardFailure(res.status)) return;
        if (!res.ok) throw new Error(`Could not load runs (${res.status})`);
        const data = await res.json();
        if (Array.isArray(data?.runs)) {
          setTaskRuns(
            data.runs
              .filter(
                (run: { runId?: string; slug?: string }) =>
                  typeof run?.runId === "string" && typeof run?.slug === "string",
              )
              .slice(0, 8)
              .map((run: { runId: string; slug: string; status?: string }) => ({
                value: `${run.slug}/${run.runId}`,
                label: run.status ? `${run.slug} · ${run.status}` : run.slug,
              })),
          );
        }
      } catch {
        setGroupErrors((current) => ({ ...current, runs: "Could not load runs" }));
      } finally {
        setLoadingGroups((current) => ({ ...current, runs: false }));
      }
    };
    load();
  }, []);

  const workspace = useWorkspaceLabel(user);
  const planLabel = billing?.plan ? billing.plan[0].toUpperCase() + billing.plan.slice(1) : null;

  const groups: {
    key: string;
    label: string;
    kind?: ResourceKind;
    items: { label: string; value: string }[];
    empty: string;
    loading?: boolean;
    error?: string;
    onNavigate?: () => void;
  }[] = [
    {
      key: "agents",
      label: "Agents",
      kind: "agent",
      items: agents.map((name) => ({ label: name, value: name })),
      empty: "No agents found",
      loading: loadingGroups.agents,
      error: groupErrors.agents,
      onNavigate: onNavigateAgents,
    },
    {
      key: "scheduled",
      label: "Workflows",
      kind: "task",
      items: tasks,
      empty: "Nothing scheduled",
      loading: loadingGroups.scheduled,
      error: groupErrors.scheduled,
      onNavigate: onNavigateScheduled,
    },
    {
      key: "runs",
      label: "Runs",
      kind: "taskrun",
      items: taskRuns,
      empty: "No runs yet",
      loading: loadingGroups.runs,
      error: groupErrors.runs,
      onNavigate: onNavigateRuns,
    },
  ];

  return (
    <div
      className={cn(
        "absolute inset-y-0 left-0 z-30 flex h-full shrink-0 overflow-hidden border-r shadow-xl transition-all duration-200 ease-in-out md:relative md:shadow-none",
        open ? "w-[274px]" : "w-0 border-r-0",
        view === "settings" && "settings-rail",
      )}
    >
      <div
        className={cn(
          "flex h-full w-[274px] shrink-0 flex-col",
          view !== "settings" && "bg-background",
        )}
      >
        {/* Phones get the sidebar as an overlay, so it needs its own way out. */}
        <div className="flex h-10 shrink-0 items-center justify-end px-2.5 md:hidden">
          <Button
            aria-label="Close sidebar"
            className="size-8 shrink-0 rounded-none text-primary/50 hover:bg-background-100 hover:text-primary"
            onClick={onToggle}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <SidebarSimple className="size-4" />
          </Button>
        </div>
        {view === "settings" ? (
          <nav className="settings-rail-scroll flex flex-1 flex-col items-stretch overflow-y-auto px-2 pb-3 pt-2">
            <Button
              className="settings-back justify-start"
              onClick={onCloseSettings}
              type="button"
              variant="ghost"
            >
              <ArrowLeft className="size-3.5" />
              Back to app
            </Button>
            <Button
              className="settings-nav-item mt-1 justify-start"
              data-active={settingsSection === "overview"}
              onClick={() => onOpenSettings?.("overview")}
              type="button"
              variant="ghost"
            >
              <GearSix />
              Settings
            </Button>
            {(["workspace", "global", "cloud", "support"] as SettingsGroup[]).map((group) => (
              <div key={group}>
                <div className="settings-rail-heading">{SETTINGS_GROUP_LABELS[group]}</div>
                <div className="space-y-0.5">
                  {SETTINGS_SECTIONS.filter((section) => section.group === group).map((section) => (
                    <Button
                      className="settings-nav-item justify-start"
                      data-active={settingsSection === section.key}
                      key={section.key}
                      onClick={() => onOpenSettings?.(section.key)}
                      type="button"
                      variant="ghost"
                    >
                      <section.icon />
                      <Label className="truncate font-normal">{section.label}</Label>
                      {section.beta ? (
                        <Badge className="settings-beta font-normal" variant="secondary">
                          Beta
                        </Badge>
                      ) : null}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        ) : (
          <nav className="no-scrollbar flex flex-1 flex-col overflow-y-auto px-2.5 pb-2 pt-2.5">
            <SidebarNavItem
              active={view === "chat" && !selected}
              label="Home"
              onClick={onNavigateChat}
            />
            {/* The wedge, first in the list: the report is what a new account
                reads before anything else. */}
            <SidebarNavItem
              active={view === "report"}
              label="Open promises"
              onClick={onNavigateReport}
            />
            {(
              ["tasks", "notes", "commitments", "queue", "scans", "impact", "actions"] as const
            ).map((tab) => (
              <SidebarNavItem
                active={view === "revenue" && activeRevenueTab === tab}
                key={tab}
                label={REVENUE_TAB_LABELS[tab]}
                onClick={() => onNavigateRevenue?.(tab)}
              />
            ))}
            <SidebarSectionLabel>Records</SidebarSectionLabel>
            <SidebarNavItem
              active={view === "revenue" && activeRevenueTab === "relationships"}
              label={REVENUE_TAB_LABELS.relationships}
              onClick={() => onNavigateRevenue?.("relationships")}
            />
            <SidebarNavItem
              active={view === "revenue" && activeRevenueTab === "people"}
              label={REVENUE_TAB_LABELS.people}
              onClick={() => onNavigateRevenue?.("people")}
            />
            <SidebarNavItem
              active={view === "revenue" && activeRevenueTab === "workspace"}
              label={REVENUE_TAB_LABELS.workspace}
              onClick={() => onNavigateRevenue?.("workspace")}
            />
            <SidebarSectionLabel>Workspace</SidebarSectionLabel>
            {groups.map((group) => (
              <Collapsible
                key={group.key}
                onOpenChange={(nextOpen) =>
                  setOpenGroups((current) => ({ ...current, [group.key]: nextOpen }))
                }
                open={Boolean(openGroups[group.key])}
              >
                <CollapsibleTrigger asChild>
                  <SidebarNavItem
                    active={activeResourceGroup === group.key}
                    chevron
                    chevronOpen={Boolean(openGroups[group.key])}
                    count={group.items.length}
                    label={group.label}
                    onClick={group.onNavigate}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-0.5 pb-1">
                    {group.loading ? (
                      <SidebarEmptyHint>Loading…</SidebarEmptyHint>
                    ) : group.error ? (
                      <SidebarEmptyHint>{group.error}</SidebarEmptyHint>
                    ) : group.items.length === 0 ? (
                      <SidebarEmptyHint>{group.empty}</SidebarEmptyHint>
                    ) : (
                      group.items.map((item) => (
                        <SidebarSubItem
                          active={selected?.kind === group.kind && selected?.name === item.value}
                          key={item.value}
                          label={item.label}
                          onClick={
                            group.kind
                              ? () => onSelectResource?.({ kind: group.kind!, name: item.value })
                              : undefined
                          }
                        />
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}

            <div className="flex items-center justify-between pl-3.5 pr-2 pb-1 pt-4">
              <Label className="text-[12px] font-normal text-primary/40">History</Label>
              <Button
                aria-label="New chat"
                className="size-6 rounded-none text-primary/50 hover:bg-background-100 hover:text-primary dark:hover:bg-background-300"
                onClick={onNewChat}
                size="icon-xs"
                title="New chat"
                type="button"
                variant="ghost"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
            {sessions.length === 0 ? (
              <SidebarEmptyHint>No conversations yet</SidebarEmptyHint>
            ) : (
              sessions.map((session) => (
                <SidebarSubItem
                  active={session.runId === activeRunId}
                  key={session.runId}
                  label={session.title}
                  onClick={() => onOpenSession?.(session.runId)}
                />
              ))
            )}
          </nav>
        )}

        <div
          className={cn(
            "flex shrink-0 flex-col gap-0.5 px-2.5 pt-2",
            view === "settings" && "settings-rail-footer",
          )}
        >
          <SidebarStatusCard billing={billing} onOpen={() => onNavigateRevenue?.("workspace")} />
          {/* Help used to open the OpenAPI reference: an operator who clicked
              it because a promise was missed landed on a route table. */}
          <Link
            className={SIDEBAR_FOOTER_LINK}
            href="/blog"
            rel="noopener noreferrer"
            target="_blank"
          >
            Need help?
          </Link>
          {/* A plain anchor, not Link: the route only redirects to the API's
              docs, and Link's RSC prefetch of it failed with a 503 on every
              page load. This is the OpenAPI spec, not product documentation;
              calling it "Docs" sent operators looking for help into a route
              table. */}
          <a
            className={SIDEBAR_FOOTER_LINK}
            href="/api/reference"
            rel="noopener noreferrer"
            target="_blank"
          >
            API reference
          </a>
          <SidebarNavItem
            active={view === "settings"}
            label="Settings"
            onClick={() => onOpenSettings?.("overview")}
          />
        </div>

        <div className="mx-2.5 mt-2 flex h-14 shrink-0 items-center border-t">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-10 min-w-0 flex-1 justify-start gap-2.5 rounded-none px-2 text-left hover:bg-background-100 data-[state=open]:bg-background-100 dark:hover:bg-background-200 dark:data-[state=open]:bg-background-200"
                type="button"
                variant="ghost"
              >
                <Avatar aria-hidden="true" className="size-6 rounded-none" size="sm">
                  <AvatarFallback className="rounded-none border border-border bg-background-100 font-mono text-[11px] uppercase text-primary/60">
                    {workspace.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
                <Label className="truncate text-[15px] font-normal text-primary">{workspace}</Label>
                {planLabel ? (
                  <Badge
                    className="shrink-0 bg-background-200 text-[12px] font-normal text-primary/55"
                    variant="secondary"
                  >
                    {planLabel}
                  </Badge>
                ) : null}
                <CaretUpDown className="ml-auto size-3.5 shrink-0 text-primary/40" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="app-shell w-[254px] rounded-none"
              side="top"
              sideOffset={6}
            >
              <DropdownMenuItem onSelect={() => onOpenSettings?.("overview")}>
                <GearSix />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="px-2 py-1.5">
                  <div className="truncate text-sm font-medium text-primary">{workspace}</div>
                  <div className="truncate font-mono text-[11px] text-primary/50">{user.email}</div>
                </div>
              </DropdownMenuLabel>
              {/* Sessions are reviewed in Settings > Security; this is the same
                  surface the account menu in the screenshot opens. */}
              <DropdownMenuItem onSelect={() => onOpenSettings?.("security")}>
                <Stack />
                Manage sessions
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  window.location.assign("/api/auth/logout");
                }}
              >
                <SignOut />
                Sign out
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs uppercase tracking-wider text-primary/50">
                  Theme
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className={theme === "light" ? "bg-muted" : ""}
                  onClick={() => handleTheme("light")}
                >
                  <Sun />
                  Light
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={theme === "dark" ? "bg-muted" : ""}
                  onClick={() => handleTheme("dark")}
                >
                  <Moon />
                  Dark
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={theme === "system" ? "bg-muted" : ""}
                  onClick={() => handleTheme("system")}
                >
                  <Monitor />
                  System
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-primary/50">
                Workspaces
              </DropdownMenuLabel>
              <DropdownMenuItem className="gap-2" onSelect={(event) => event.preventDefault()}>
                <Avatar aria-hidden="true" className="size-4 rounded-none" size="sm">
                  <AvatarImage
                    alt=""
                    className="scale-[1.85] object-contain dark:invert"
                    src="/marketing/oppulence-icon.png"
                  />
                  <AvatarFallback className="rounded-none" />
                </Avatar>
                <Label className="truncate font-normal">{workspace}</Label>
                <CheckCircle
                  className="ml-auto size-4 shrink-0 text-oppulence-orange"
                  weight="fill"
                />
                {planLabel ? (
                  <Badge
                    className="shrink-0 text-[10px] font-normal text-primary/60"
                    variant="outline"
                  >
                    {planLabel}
                  </Badge>
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {open ? (
        <Button
          aria-label="Collapse sidebar"
          className="absolute top-0 right-0 z-10 h-full w-[2px] min-w-0 cursor-w-resize rounded-none p-0 hover:bg-border"
          onClick={onToggle}
          title="Collapse sidebar  [ ]"
          type="button"
          variant="ghost"
        />
      ) : null}
    </div>
  );
}
