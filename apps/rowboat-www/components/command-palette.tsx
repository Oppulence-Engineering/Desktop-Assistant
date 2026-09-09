"use client";

import * as React from "react";
import {
  ChatCircle,
  ChatsCircle,
  FilePlus,
  Buildings,
  Folder,
  Monitor,
  Moon,
  SidebarSimple,
  SignOut,
  Sun,
} from "@phosphor-icons/react";

import {
  SETTINGS_SECTIONS,
  useThemePreference,
  type SettingsSection,
} from "@/components/app-shell";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@oppulence/ui/components/command";
import type { SessionMeta } from "@/lib/chat-sessions";
import { listRelationships } from "@/lib/revenue";
import type { RevenueRelationship } from "@/types/revenue";

export function CommandPalette({
  open,
  onOpenChange,
  agents,
  sessions,
  onNewChat,
  onNavigateChat,
  onNavigateRelationship,
  onOpenSettings,
  onOpenAgent,
  onOpenSession,
  onToggleSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: string[];
  sessions: SessionMeta[];
  onNewChat: () => void;
  onNavigateChat: () => void;
  /** Opens one account record. Optional so the palette still renders in
   *  contexts that have no relationship surface to jump to. */
  onNavigateRelationship?: (relationshipId: string) => void;
  onOpenSettings: (section: SettingsSection) => void;
  onOpenAgent: (name: string) => void;
  onOpenSession: (runId: string) => void;
  onToggleSidebar: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [accounts, setAccounts] = React.useState<RevenueRelationship[]>([]);
  const [searching, setSearching] = React.useState(false);
  const { setTheme } = useThemePreference();

  const runAnd = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  // The palette advertised "search" from the most prominent control in the
  // sidebar, but only ever filtered this static command list — typing the name
  // of a real account returned "No results found". Accounts are what an
  // operator looks for by name, so they are what it searches.
  React.useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2) {
      setAccounts([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      let cancelled = false;
      void listRelationships({ q: term })
        .then((rows) => {
          if (!cancelled) setAccounts(rows.slice(0, 6));
        })
        .catch(() => {
          if (!cancelled) setAccounts([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
      return () => {
        cancelled = true;
      };
    }, 200);
    return () => clearTimeout(timer);
  }, [open, query]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <CommandDialog
      className="app-shell rounded-[2px]"
      description="Search actions, agents, and conversations"
      onOpenChange={onOpenChange}
      open={open}
      title="Command palette"
    >
      <CommandInput
        onValueChange={setQuery}
        placeholder="Search accounts, or type a command…"
        value={query}
      />
      <CommandList>
        <CommandEmpty>
          {searching ? "Searching…" : "No results found."}
        </CommandEmpty>
        {accounts.length > 0 ? (
          <>
            <CommandGroup heading="Accounts">
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  // cmdk filters on value; the server already matched, so keep
                  // the typed query as the value to stop it filtering results
                  // the API deliberately returned.
                  value={`${query} ${account.displayName}`}
                  onSelect={runAnd(() => onNavigateRelationship?.(account.id))}
                >
                  <Buildings />
                  {account.displayName}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={runAnd(onNewChat)}>
            <FilePlus />
            New chat
          </CommandItem>
          <CommandItem onSelect={runAnd(onToggleSidebar)}>
            <SidebarSimple />
            Toggle sidebar
            <CommandShortcut>[</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={runAnd(() => setTheme("light"))}>
            <Sun />
            Theme: light
          </CommandItem>
          <CommandItem onSelect={runAnd(() => setTheme("dark"))}>
            <Moon />
            Theme: dark
          </CommandItem>
          <CommandItem onSelect={runAnd(() => setTheme("system"))}>
            <Monitor />
            Theme: system
          </CommandItem>
          <CommandItem onSelect={runAnd(() => window.location.assign("/api/auth/logout"))}>
            <SignOut />
            Sign out
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={runAnd(onNavigateChat)}>
            <ChatsCircle />
            Chat
          </CommandItem>
          {SETTINGS_SECTIONS.map((section) => (
            <CommandItem key={section.key} onSelect={runAnd(() => onOpenSettings(section.key))}>
              <section.icon />
              Settings · {section.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {agents.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Agents">
              {agents.map((name) => (
                <CommandItem key={name} onSelect={runAnd(() => onOpenAgent(name))}>
                  <Folder />
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
        {sessions.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Conversations">
              {sessions.slice(0, 8).map((session) => (
                <CommandItem
                  key={session.runId}
                  onSelect={runAnd(() => onOpenSession(session.runId))}
                  value={`${session.title} ${session.runId}`}
                >
                  <ChatCircle />
                  <span className="truncate">{session.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
