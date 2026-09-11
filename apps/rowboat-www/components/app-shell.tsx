"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  AddressBook,
  FileText,
  Bell,
  Brain,
  BookOpen,
  Buildings,
  CaretLeft,
  CaretRight,
  CaretUpDown,
  ChartLineUp,
  CheckCircle,
  CheckSquare,
  Clock,
  Cpu,
  Folder,
  GearSix,
  HardDrives,
  House,
  ListChecks,
  MagnifyingGlass,
  Monitor,
  Moon,
  Palette,
  Play,
  Plugs,
  Plus,
  Question,
  Rocket,
  ShieldCheck,
  SidebarSimple,
  SignOut,
  Stack,
  Sun,
  Tag,
  TerminalWindow,
  Tray,
  Waveform,
  Wallet,
  WarningCircle,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { AppIcon } from "@/components/ui/app-icon";
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
import { getPref, setPref, usePref } from "@/lib/console-prefs";
import { listRelationshipSourceStatuses } from "@/lib/revenue";
import { loadChangelog, type ChangelogEntry } from "@/lib/api/changelog/changelog";
import type { ProductView } from "@/lib/product-navigation";
import type { RelationshipSourceStatus } from "@/types/revenue";
import { cn } from "@/lib/utils";

export type ResourceKind = "agent" | "config" | "run" | "task" | "taskrun";

export type RevenueTab =
  | "tasks"
  | "notes"
  | "commitments"
  | "relationships"
  | "people"
  | "queue"
  | "scans"
  | "impact"
  | "actions"
  | "workspace";

export const REVENUE_TAB_LABELS: Record<RevenueTab, string> = {
  tasks: "Tasks",
  notes: "Notes",
  commitments: "Commitments",
  relationships: "Companies",
  people: "People",
  queue: "Recovery",
  scans: "Audits",
  impact: "Impact",
  actions: "Actions",
  workspace: "Sources",
};

export type SettingsSection =
  | "overview"
  | "preferences"
  | "notifications"
  | "permissions"
  | "security"
  | "extensions"
  | "connections"
  | "transcription"
  | "note-tagging"
  | "advanced"
  | "models"
  | "code-mode"
  | "customization"
  | "appearance"
  | "mcp"
  | "environment"
  | "updates"
  | "memory"
  | "recovery"
  | "account"
  | "connect"
  | "help";

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
    key: "extensions",
    label: "Extensions",
    icon: Plugs,
    group: "workspace",
    description: "Connect the services and tools your relationships live in.",
  },
  {
    key: "connections",
    label: "Connections",
    icon: Plugs,
    group: "workspace",
    description: "Manage connected accounts and available tools.",
  },
  {
    key: "transcription",
    label: "Transcription",
    icon: Waveform,
    group: "workspace",
    description: "Review speech-to-text availability and desktop configuration.",
  },
  {
    key: "note-tagging",
    label: "Note Tagging",
    icon: Tag,
    group: "workspace",
    description: "Manage the note and email taxonomy used by the desktop app.",
  },
  {
    key: "advanced",
    label: "Advanced",
    icon: Rocket,
    group: "workspace",
    description: "Inspect endpoints, diagnostics, and advanced workspace controls.",
  },
  {
    key: "models",
    label: "AI Providers",
    icon: Cpu,
    group: "global",
    description: "Choose the models that reason over relationship evidence.",
  },
  {
    key: "code-mode",
    label: "Code Mode",
    icon: TerminalWindow,
    group: "global",
    description: "Review governed agent execution and approval behavior.",
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
    key: "mcp",
    label: "MCP Servers",
    icon: HardDrives,
    group: "global",
    description: "Review the tool servers available to desktop agents.",
  },
  {
    key: "environment",
    label: "Environment",
    icon: Monitor,
    group: "global",
    description: "Review the browser, runtime, and API environment.",
  },
  {
    key: "updates",
    label: "Updates",
    icon: Play,
    group: "global",
    description: "Keep the product current with controlled release settings.",
  },
  {
    key: "memory",
    label: "Memory",
    icon: Brain,
    group: "global",
    description: "Manage private semantic memory preferences.",
  },
  {
    key: "recovery",
    label: "Recovery",
    icon: BookOpen,
    group: "global",
    description: "Reset local preferences or recover your workspace session.",
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
          <button
            className="mt-4 h-8 border border-border bg-background px-3 text-[13px] text-primary transition-colors hover:bg-background-100"
            onClick={() => this.setState({ failed: false })}
            type="button"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}

/* ------------------------------ sidebar footer ----------------------------- */

const CHANGELOG_SEEN_PREF = "sidebar-changelog-seen";

// One gradient per position, so paging through releases is visible at a glance.
const CHANGELOG_GRADIENTS = [
  "from-oppulence-blue to-indigo-900",
  "from-oppulence-orange to-rose-900",
  "from-oppulence-green to-emerald-900",
];

function releaseDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date
        .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        .toUpperCase()
    : "LATEST RELEASE";
}

/**
 * The newest releases, paged. The card carries a version the user can check
 * against the release notes, so it is hidden entirely when the feed is empty
 * or unreachable — an announcement we cannot source is worse than none.
 */
function SidebarChangelog() {
  const [entries, setEntries] = React.useState<ChangelogEntry[]>([]);
  const [index, setIndex] = React.useState(0);
  // The sidebar only ever renders on the client (AuthGate holds the tree until
  // the session resolves), so reading the pref during render cannot desync
  // hydration and a dismissed card never flashes.
  const [seen, setSeen] = React.useState(() => getPref(CHANGELOG_SEEN_PREF));

  React.useEffect(() => {
    let cancelled = false;
    loadChangelog()
      .then((loaded) => {
        if (!cancelled) setEntries(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) return null;
  // Dismissal is per release: the card returns on its own when the next one
  // ships, so nobody has to remember to re-enable it.
  if (seen === entries[0].version) return null;
  const card = entries[index];
  const step = (delta: number) =>
    setIndex((current) => (current + delta + entries.length) % entries.length);

  return (
    <div className="relative mb-2 border border-border bg-background">
      <button
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 z-10 flex size-6 items-center justify-center text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        onClick={() => {
          setPref(CHANGELOG_SEEN_PREF, entries[0].version);
          setSeen(entries[0].version);
        }}
        type="button"
      >
        <X className="size-3.5" />
      </button>
      <Link
        className="block overflow-hidden"
        href={card.url}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span
          className={cn(
            "relative flex h-[72px] flex-col items-center justify-center gap-0.5 bg-gradient-to-br px-4 text-center",
            CHANGELOG_GRADIENTS[index % CHANGELOG_GRADIENTS.length],
          )}
        >
          <span className="text-[15px] font-semibold leading-tight text-white">{card.version}</span>
          <span className="font-mono text-[9px] tracking-[0.12em] text-white/70">
            {releaseDate(card.date)}
          </span>
        </span>
        <span className="block px-3 pb-2 pt-2.5">
          <span className="block text-[13px] font-medium leading-snug text-primary">
            {card.title}
          </span>
          <span className="mt-1 block text-[12px] leading-snug text-primary/50">{card.body}</span>
        </span>
      </Link>
      {entries.length > 1 ? (
        <div className="flex items-center justify-between px-3 pb-2.5">
          <div className="flex items-center gap-1.5">
            {entries.map((entry, position) => (
              <button
                aria-label={entry.version}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  position === index ? "bg-oppulence-blue" : "bg-primary/20",
                )}
                key={entry.version}
                onClick={() => setIndex(position)}
                type="button"
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous"
              className="flex size-6 items-center justify-center border border-border text-primary/60 transition-colors hover:bg-background-100 hover:text-primary"
              onClick={() => step(-1)}
              type="button"
            >
              <CaretLeft className="size-3" />
            </button>
            <button
              aria-label="Next"
              className="flex size-6 items-center justify-center border border-border text-primary/60 transition-colors hover:bg-background-100 hover:text-primary"
              onClick={() => step(1)}
              type="button"
            >
              <CaretRight className="size-3" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

const SOURCE_TONE_DOT: Record<SourceHealth["tone"], string> = {
  ok: "bg-oppulence-green",
  syncing: "bg-oppulence-blue",
  attention: "bg-amber-500",
  idle: "bg-primary/25",
};

function SidebarSources({ onOpen }: { onOpen?: () => void }) {
  const [health, setHealth] = React.useState<SourceHealth | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listRelationshipSourceStatuses()
      .then((sources) => {
        if (!cancelled) setHealth(sourceHealth(sources));
      })
      .catch(() => {
        if (!cancelled) setHealth({ tone: "idle", label: "Source status unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!health) return null;
  return (
    <button
      className="mb-1 flex h-9 w-full items-center gap-2 border border-border bg-background px-2.5 text-left text-[13px] text-primary/70 transition-colors hover:bg-background-100 hover:text-primary"
      onClick={onOpen}
      type="button"
    >
      <span className={cn("size-2 shrink-0 rounded-full", SOURCE_TONE_DOT[health.tone])} />
      <span className="truncate">{health.label}</span>
    </button>
  );
}

/* --------------------------------- sidebar --------------------------------- */

function SidebarNavItem({
  icon: Icon,
  label,
  count,
  active,
  chevron,
  chevronOpen,
  href,
  className,
  ...props
}: {
  icon: PhosphorIcon;
  label: string;
  count?: number;
  active?: boolean;
  chevron?: boolean;
  chevronOpen?: boolean;
  href?: string;
} & React.ComponentProps<"button">) {
  const classes = cn(
    "group/item flex h-8 w-full items-center gap-2 rounded-none px-2 py-1 text-left text-[13px] text-primary/70 transition-colors hover:bg-background-100 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 dark:hover:bg-background-200",
    active && "bg-background-200 text-primary dark:bg-background-200",
    className,
  );
  const content = (
    <>
      <AppIcon
        className={cn(
          "text-primary/40 transition-all group-hover/item:rotate-[-4deg] group-hover/item:text-primary/80",
          active && "text-primary/80",
        )}
        filled={active}
        icon={Icon}
      />
      <span className="truncate">{label}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="ml-auto text-xs text-primary/40">{count}</span>
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
      <Link aria-current={active ? "page" : undefined} className={classes} href={href}>
        {content}
      </Link>
    );
  }
  return (
    <button className={classes} type="button" {...props}>
      {content}
    </button>
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
    <button
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-none py-1 pr-3 pl-5 text-left text-sm text-primary/65 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-200",
        active && "bg-background-200 text-primary dark:bg-background-200",
        muted && "text-primary/50",
      )}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "size-1 shrink-0 rounded-full bg-primary/30",
          active && "bg-oppulence-orange",
        )}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

function SidebarEmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-1.5 text-xs text-muted-foreground">{children}</div>;
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
  onOpenSearch,
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
  onOpenSearch?: () => void;
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
        if (res.status === 404) return; // Agent runtime is optional when Temporal is not configured.
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
      } catch (error) {
        console.error("Failed to load Oppulence summary", error);
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
  const trialDaysLeft = trialDaysRemaining(billing);
  const planLabel = billing?.plan ? billing.plan[0].toUpperCase() + billing.plan.slice(1) : null;

  const groups: {
    key: string;
    label: string;
    icon: PhosphorIcon;
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
      icon: Folder,
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
      icon: Clock,
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
      icon: Play,
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
      <div className="flex h-full w-[274px] shrink-0 flex-col bg-background-50/70 dark:bg-background-50">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-none border border-border bg-background px-2 text-left transition-colors hover:bg-background-100 data-[state=open]:bg-background-100 dark:hover:bg-background-200 dark:data-[state=open]:bg-background-200"
                type="button"
              >
                <span className="relative size-4 shrink-0 overflow-hidden" aria-hidden="true">
                  <Image
                    alt=""
                    className="scale-[1.85] object-contain dark:invert"
                    fill
                    sizes="16px"
                    src="/marketing/oppulence-icon.png"
                  />
                </span>
                <span className="truncate text-[13px] font-medium text-primary">{workspace}</span>
                <CaretUpDown className="ml-auto size-3.5 shrink-0 text-primary/40" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="app-shell w-[264px] rounded-none"
              side="bottom"
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
                <span className="relative size-4 shrink-0 overflow-hidden" aria-hidden="true">
                  <Image
                    alt=""
                    className="scale-[1.85] object-contain dark:invert"
                    fill
                    sizes="16px"
                    src="/marketing/oppulence-icon.png"
                  />
                </span>
                <span className="truncate">{workspace}</span>
                <CheckCircle
                  className="ml-auto size-4 shrink-0 text-oppulence-orange"
                  weight="fill"
                />
                {planLabel ? (
                  <span className="shrink-0 border border-border px-1.5 py-0.5 text-[10px] text-primary/60">
                    {planLabel}
                  </span>
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            aria-label="Close sidebar"
            className="flex size-8 shrink-0 items-center justify-center rounded-none text-primary/50 hover:bg-background-100 hover:text-primary md:hidden"
            onClick={onToggle}
            type="button"
          >
            <SidebarSimple className="size-4" />
          </button>
        </div>
        {view === "settings" ? (
          <nav className="settings-rail-scroll flex flex-1 flex-col overflow-y-auto px-2 pb-3 pt-2">
            <button className="settings-back" onClick={onCloseSettings} type="button">
              <ArrowLeft className="size-3.5" />
              <span>Back to app</span>
            </button>
            <button
              className="settings-nav-item mt-1"
              data-active={settingsSection === "overview"}
              onClick={() => onOpenSettings?.("overview")}
              type="button"
            >
              <GearSix />
              <span>Settings</span>
            </button>
            {(["workspace", "global", "cloud", "support"] as SettingsGroup[]).map((group) => (
              <div key={group}>
                <div className="settings-rail-heading">{SETTINGS_GROUP_LABELS[group]}</div>
                <div className="space-y-0.5">
                  {SETTINGS_SECTIONS.filter((section) => section.group === group).map((section) => (
                    <button
                      className="settings-nav-item"
                      data-active={settingsSection === section.key}
                      key={section.key}
                      onClick={() => onOpenSettings?.(section.key)}
                      type="button"
                    >
                      <section.icon />
                      <span className="truncate">{section.label}</span>
                      {section.beta ? <span className="settings-beta">Beta</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        ) : (
          <nav className="no-scrollbar flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
            <button
              className="mb-1 flex h-8 w-full items-center gap-2 rounded-none border border-border bg-background px-2 text-left text-[13px] text-primary/65 transition-colors hover:bg-background-100 hover:text-primary"
              onClick={onOpenSearch}
              type="button"
            >
              <MagnifyingGlass className="size-3.5" />
              <span>Search</span>
              <span className="ml-auto rounded border border-border px-1 py-0.5 font-mono text-[10px] text-primary/40">
                ⌘ K
              </span>
            </button>
            <SidebarNavItem
              active={view === "chat" && !selected}
              icon={House}
              label="Home"
              onClick={onNavigateChat}
            />
            {/* The wedge, first in the list: the report is what a new account
                reads before anything else. */}
            <SidebarNavItem
              active={view === "report"}
              icon={FileText}
              label="Open promises"
              onClick={onNavigateReport}
            />
            {(
              [
                ["tasks", CheckSquare],
                ["notes", BookOpen],
                ["commitments", CheckSquare],
                ["queue", Tray],
                ["scans", MagnifyingGlass],
                ["impact", ChartLineUp],
                ["actions", ListChecks],
              ] as const
            ).map(([tab, icon]) => (
              <SidebarNavItem
                active={view === "revenue" && activeRevenueTab === tab}
                icon={icon}
                key={tab}
                label={REVENUE_TAB_LABELS[tab]}
                onClick={() => onNavigateRevenue?.(tab)}
              />
            ))}
            <div className="px-2 pb-1 pt-3 text-[11px] font-medium text-primary/40">Records</div>
            <SidebarNavItem
              active={view === "revenue" && activeRevenueTab === "relationships"}
              icon={Buildings}
              label={REVENUE_TAB_LABELS.relationships}
              onClick={() => onNavigateRevenue?.("relationships")}
            />
            <SidebarNavItem
              active={view === "revenue" && activeRevenueTab === "people"}
              icon={AddressBook}
              label={REVENUE_TAB_LABELS.people}
              onClick={() => onNavigateRevenue?.("people")}
            />
            <SidebarNavItem
              active={view === "revenue" && activeRevenueTab === "workspace"}
              icon={Plugs}
              label={REVENUE_TAB_LABELS.workspace}
              onClick={() => onNavigateRevenue?.("workspace")}
            />
            <div className="px-2 pb-1 pt-3 text-[11px] font-medium text-primary/40">Workspace</div>
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
                    icon={group.icon}
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

            <div className="flex items-center justify-between px-3 pt-4 pb-1">
              <p className="text-[11px] font-medium text-primary/45">History</p>
              <button
                aria-label="New chat"
                className="flex size-5 items-center justify-center rounded text-primary/50 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-300"
                onClick={onNewChat}
                title="New chat"
                type="button"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {sessions.length === 0 ? (
              <SidebarEmptyHint>No conversations yet</SidebarEmptyHint>
            ) : (
              <>
                {sessions.map((session) => (
                  <SidebarSubItem
                    active={session.runId === activeRunId}
                    key={session.runId}
                    label={session.title}
                    onClick={() => onOpenSession?.(session.runId)}
                  />
                ))}
              </>
            )}
          </nav>
        )}

        <div className="flex shrink-0 flex-col gap-1 px-2 py-2">
          <SidebarChangelog />
          <SidebarSources onOpen={() => onNavigateRevenue?.("workspace")} />
          <Link
            className="group/item flex h-9 w-full items-center gap-2.5 rounded-none px-2.5 py-1 text-sm text-primary/70 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-200"
            href="/api/reference"
            rel="noopener noreferrer"
            target="_blank"
          >
            <AppIcon
              className="text-primary/40 transition-all group-hover/item:rotate-[-4deg] group-hover/item:text-primary/80"
              icon={BookOpen}
            />
            {/* This is the OpenAPI spec, not product documentation. Calling it
                "Docs" sent operators looking for help into a route table. */}
            API reference
          </Link>
          <SidebarNavItem
            active={view === "settings"}
            icon={GearSix}
            label="Settings"
            onClick={() => onOpenSettings?.("overview")}
          />
          {trialDaysLeft === null ? null : (
            <div className="mt-1 border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
                <Clock className="size-3.5 shrink-0 text-amber-500" />
                You are on a trial plan
              </div>
              <p className="mt-0.5 text-[12px] text-primary/55">
                <span className="font-medium text-primary">
                  {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"}
                </span>{" "}
                left on your trial.
              </p>
            </div>
          )}
        </div>
      </div>

      {open ? (
        <button
          aria-label="Collapse sidebar"
          className="absolute top-0 right-0 z-10 h-full w-[2px] cursor-w-resize transition-colors hover:bg-border"
          onClick={onToggle}
          title="Collapse sidebar  [ ]"
          type="button"
        />
      ) : null}
    </div>
  );
}
