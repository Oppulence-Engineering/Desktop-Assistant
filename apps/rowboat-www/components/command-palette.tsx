"use client";

import * as React from "react";
import {
  ChatCircle,
  ChatsCircle,
  FilePlus,
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

export function CommandPalette({
  open,
  onOpenChange,
  agents,
  sessions,
  onNewChat,
  onNavigateChat,
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
  onOpenSettings: (section: SettingsSection) => void;
  onOpenAgent: (name: string) => void;
  onOpenSession: (runId: string) => void;
  onToggleSidebar: () => void;
}) {
  const { setTheme } = useThemePreference();

  const runAnd = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  return (
    <CommandDialog
      className="app-shell rounded-[2px]"
      description="Search actions, agents, and conversations"
      onOpenChange={onOpenChange}
      open={open}
      title="Command palette"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
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
