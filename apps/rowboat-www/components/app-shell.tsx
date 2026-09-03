"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  AddressBook,
  Bell,
  Brain,
  BookOpen,
  CaretRight,
  CaretUpDown,
  ChatsCircle,
  Clock,
  Cpu,
  Folder,
  GearSix,
  HardDrives,
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
  Sun,
  Tag,
  TerminalWindow,
  Waveform,
  Wallet,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { AppIcon } from "@/components/ui/app-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@oppulence/ui/components/avatar";
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
import { Separator } from "@oppulence/ui/components/separator";
import { dashboardFetch } from "@/lib/auth/client";
import { usePref } from "@/lib/console-prefs";
import { cn } from "@/lib/utils";

export type ResourceKind = "agent" | "config" | "run" | "task" | "taskrun";

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
  avatar: string;
};

/* --------------------------------- sidebar --------------------------------- */

function SidebarNavItem({
  icon: Icon,
  label,
  count,
  active,
  chevron,
  chevronOpen,
  className,
  ...props
}: {
  icon: PhosphorIcon;
  label: string;
  count?: number;
  active?: boolean;
  chevron?: boolean;
  chevronOpen?: boolean;
} & React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "group/item flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-sm text-primary/70 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-200",
        active && "bg-background-200 text-primary dark:bg-background-200",
        className,
      )}
      type="button"
      {...props}
    >
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
        "flex h-8 w-full items-center gap-2.5 rounded-md py-1 pr-3 pl-5 text-left text-sm text-primary/65 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-200",
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
  selected,
  onSelectResource,
  onNavigateChat,
  onNavigateRevenue,
  onNavigateAgents,
  onNavigateScheduled,
  onNavigateRuns,
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
  selected: { kind: ResourceKind; name: string } | null;
  onSelectResource?: SidebarSelect;
  onNavigateChat?: () => void;
  onNavigateRevenue?: () => void;
  onNavigateAgents?: () => void;
  onNavigateScheduled?: () => void;
  onNavigateRuns?: () => void;
  activeResourceGroup?: "agents" | "scheduled" | "runs";
  view?: "chat" | "settings" | "revenue" | "workflows" | "agents";
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

  const displayName = usePref("display-name") || user.name;
  const fallback = (displayName || user.email || "U").slice(0, 2).toUpperCase();

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
      label: "Scheduled",
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
        open ? "w-64" : "w-0 border-r-0",
        view === "settings" && "settings-rail",
      )}
    >
      <div className="flex h-full w-64 shrink-0 flex-col bg-background-50/70 dark:bg-background-50">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <Image
            alt=""
            className="size-5"
            height={20}
            src="/marketing/oppulence-icon.png"
            width={20}
          />
          <span className="text-sm font-medium tracking-tight text-primary">Oppulence</span>
          <button
            aria-label="Close sidebar"
            className="ml-auto flex size-8 items-center justify-center rounded-md text-primary/50 hover:bg-background-100 hover:text-primary md:hidden"
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
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
            <SidebarNavItem
              active={view === "chat" && !selected}
              icon={ChatsCircle}
              label="Chat"
              onClick={onNavigateChat}
            />
            <SidebarNavItem
              active={view === "revenue"}
              icon={AddressBook}
              label="Relationships"
              onClick={onNavigateRevenue}
            />
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

        <div className="flex flex-col gap-1 px-2 py-2">
          <Link
            className="group/item flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-sm text-primary/70 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-200"
            href="/api/reference"
          >
            <AppIcon
              className="text-primary/40 transition-all group-hover/item:rotate-[-4deg] group-hover/item:text-primary/80"
              icon={BookOpen}
            />
            Docs
          </Link>
          <SidebarNavItem
            active={view === "settings"}
            icon={GearSix}
            label="Settings"
            onClick={() => onOpenSettings?.("overview")}
          />
          <Separator className="my-1 opacity-30" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background-100 data-[state=open]:bg-background-100 dark:hover:bg-background-200 dark:data-[state=open]:bg-background-200"
                type="button"
              >
                <Avatar className="size-8 rounded-full ring-1 ring-border">
                  <AvatarImage alt={user.name} src={user.avatar} />
                  <AvatarFallback className="rounded-full font-mono text-xs">
                    {fallback}
                  </AvatarFallback>
                </Avatar>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium text-primary">{displayName}</span>
                  <span className="truncate text-xs text-primary/50">{user.email}</span>
                </span>
                <CaretUpDown className="size-4 text-primary/40" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="app-shell min-w-56 rounded-xl"
              side="right"
              sideOffset={8}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8 rounded-full ring-1 ring-border">
                    <AvatarImage alt={user.name} src={user.avatar} />
                    <AvatarFallback className="rounded-full font-mono text-xs">
                      {fallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{displayName}</span>
                    <span className="truncate text-xs text-primary/50">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
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
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  window.location.assign("/api/auth/logout");
                }}
              >
                <SignOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
