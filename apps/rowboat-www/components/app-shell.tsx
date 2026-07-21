"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  CaretRight,
  CaretUpDown,
  ChatsCircle,
  Clock,
  Cpu,
  DotsThree,
  Folder,
  GearSix,
  Monitor,
  Moon,
  Palette,
  Play,
  Plugs,
  Plus,
  Rocket,
  SignOut,
  Sun,
  Wallet,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { AppIcon } from "@/components/ui/app-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { dashboardFetch } from "@/lib/auth/client";
import { usePref } from "@/lib/console-prefs";
import { cn } from "@/lib/utils";

export type ResourceKind = "agent" | "config" | "run" | "task" | "taskrun";

export type SettingsSection = "general" | "appearance" | "models" | "connectors" | "plan";

export const SETTINGS_SECTIONS: { key: SettingsSection; label: string; icon: PhosphorIcon }[] = [
  { key: "general", label: "General", icon: GearSix },
  { key: "appearance", label: "Appearance", icon: Palette },
  { key: "models", label: "Models", icon: Cpu },
  { key: "connectors", label: "Connectors", icon: Plugs },
  { key: "plan", label: "Plan & Usage", icon: Wallet },
];

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

/* ---------------------------------- topbar --------------------------------- */

export function AppShellTopbar() {
  return (
    <header className="flex h-16 min-h-16 w-full items-center justify-between pr-5 pl-6">
      <div className="flex items-center gap-2.5">
        <img alt="Oppulence" className="size-5.5" src="/marketing/oppulence-icon.png" />
        <span className="text-sm font-medium text-primary">Oppulence</span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          className="flex h-8 items-center gap-1.5 rounded px-2.5 text-sm text-primary/70 transition-colors hover:bg-background-200 hover:text-primary dark:hover:bg-background-100"
          href="/api/reference"
        >
          Docs
        </Link>
        <span className="flex h-8 items-center gap-1.5 rounded px-2.5 text-sm text-primary/70">
          Assistant
          <span className="rounded-sm bg-oppulence-orange px-1.5 py-0.5 text-[10px] font-medium text-white">
            AI
          </span>
        </span>
      </div>
    </header>
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
        "group/item flex h-10 w-full items-center gap-2.5 rounded px-3 py-1 text-left text-sm text-primary/80 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-300",
        active && "bg-background-100 text-primary dark:bg-background-300",
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
        "flex h-8 w-full items-center gap-2.5 rounded py-1 pr-3 pl-5 text-left text-sm text-primary/70 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-300",
        active && "bg-background-100 text-primary dark:bg-background-300",
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
  view = "chat",
  settingsSection = "general",
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
  view?: "chat" | "settings";
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
  const [loading, setLoading] = React.useState(true);
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const { theme, setTheme: handleTheme } = useThemePreference();

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await dashboardFetch("/api/rowboat/v1/agents");
        if (!res.ok) return;
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
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await dashboardFetch("/api/rowboat/v1/background-tasks");
        if (!res.ok) return;
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
        /* background tasks are optional — the group just stays empty */
      }
    };
    load();
  }, []);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await dashboardFetch("/api/rowboat/v1/background-task-runs");
        if (!res.ok) return;
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
        /* runs are optional — the group just stays empty */
      }
    };
    load();
  }, []);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const displayName = usePref("display-name") || user.name;
  const fallback = (displayName || user.email || "U").slice(0, 2).toUpperCase();

  const groups: {
    key: string;
    label: string;
    icon: PhosphorIcon;
    kind?: ResourceKind;
    items: { label: string; value: string }[];
    empty: string;
  }[] = [
    {
      key: "agents",
      label: "Agents",
      icon: Folder,
      kind: "agent",
      items: agents.map((name) => ({ label: name, value: name })),
      empty: "No agents found",
    },
    {
      key: "config",
      label: "Config",
      icon: Plugs,
      kind: "config",
      items: [],
      empty: "No config files",
    },
    {
      key: "scheduled",
      label: "Scheduled",
      icon: Clock,
      kind: "task",
      items: tasks,
      empty: "Nothing scheduled",
    },
    {
      key: "runs",
      label: "Runs",
      icon: Play,
      kind: "taskrun",
      items: taskRuns,
      empty: "No runs yet",
    },
    { key: "applets", label: "Applets", icon: Rocket, items: [], empty: "No applets yet" },
  ];

  return (
    <div
      className={cn(
        "relative flex h-full shrink-0 overflow-hidden border-r transition-all duration-200 ease-in-out",
        open ? "w-72" : "w-0 border-r-0",
      )}
    >
      <div className="flex h-full w-72 shrink-0 flex-col">
        {view === "settings" ? (
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
            <div className="mb-1 flex items-center gap-1.5 px-1 pt-1">
              <button
                aria-label="Back to chat"
                className="flex size-7 items-center justify-center rounded-md text-primary/60 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-300"
                onClick={onCloseSettings}
                type="button"
              >
                <ArrowLeft className="size-4" />
              </button>
              <span className="text-sm font-medium text-primary">Settings</span>
            </div>
            {SETTINGS_SECTIONS.map((section) => (
              <SidebarNavItem
                active={settingsSection === section.key}
                icon={section.icon}
                key={section.key}
                label={section.label}
                onClick={() => onOpenSettings?.(section.key)}
              />
            ))}
          </nav>
        ) : (
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
            <SidebarNavItem
              active={!selected}
              icon={ChatsCircle}
              label="Chat"
              onClick={onNavigateChat}
            />
            {groups.map((group) => (
              <Collapsible
                key={group.key}
                onOpenChange={() => toggleGroup(group.key)}
                open={Boolean(openGroups[group.key])}
              >
                <CollapsibleTrigger asChild>
                  <SidebarNavItem
                    chevron
                    chevronOpen={Boolean(openGroups[group.key])}
                    count={group.items.length}
                    icon={group.icon}
                    label={group.label}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-0.5 pb-1">
                    {loading && group.key === "agents" ? (
                      <SidebarEmptyHint>Loading…</SidebarEmptyHint>
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
              <p className="text-[11px] uppercase tracking-wider text-primary/50">Chat history</p>
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
                {sessions.slice(0, 8).map((session) => (
                  <SidebarSubItem
                    active={session.runId === activeRunId}
                    key={session.runId}
                    label={session.title}
                    onClick={() => onOpenSession?.(session.runId)}
                  />
                ))}
                {sessions.length > 8 ? (
                  <div className="flex h-8 w-full items-center gap-2.5 py-1 pr-3 pl-5 text-sm text-primary/40">
                    <DotsThree className="size-3.5 shrink-0" />
                    <span>{sessions.length - 8} more</span>
                  </div>
                ) : null}
              </>
            )}
          </nav>
        )}

        <div className="flex flex-col gap-1 px-2 py-2">
          <Link
            className="group/item flex h-10 w-full items-center gap-2.5 rounded px-3 py-1 text-sm text-primary/80 transition-colors hover:bg-background-100 hover:text-primary dark:hover:bg-background-300"
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
            onClick={() => onOpenSettings?.("general")}
          />
          <Separator className="my-1 opacity-30" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-background-100 data-[state=open]:bg-background-100 dark:hover:bg-background-300 dark:data-[state=open]:bg-background-300"
                type="button"
              >
                <Avatar className="size-8 rounded-[2px] ring-1 ring-border">
                  <AvatarImage alt={user.name} src={user.avatar} />
                  <AvatarFallback className="rounded-[2px] font-mono text-xs">
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
              className="app-shell min-w-56 rounded-[2px]"
              side="right"
              sideOffset={8}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8 rounded-[2px] ring-1 ring-border">
                    <AvatarImage alt={user.name} src={user.avatar} />
                    <AvatarFallback className="rounded-[2px] font-mono text-xs">
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
