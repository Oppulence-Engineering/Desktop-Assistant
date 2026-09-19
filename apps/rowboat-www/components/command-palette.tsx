"use client";

import * as React from "react";
import {
  ChatCircle,
  ChatsCircle,
  EnvelopeSimple,
  FilePlus,
  Buildings,
  Folder,
  Monitor,
  Moon,
  SidebarSimple,
  SignOut,
  Sun,
} from "@/lib/icons";

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
import { Button } from "@oppulence/ui/components/button";
import { Label } from "@oppulence/ui/components/label";
import { Spinner } from "@oppulence/ui/components/spinner";
import { useRelationships, useSemanticSearch } from "@/hooks/queries/use-relationships";
import type { SessionMeta } from "@/lib/chat-sessions";
import type { SemanticMatch } from "@/lib/revenue";

export function CommandPalette({
  open,
  onOpenChange,
  agents,
  sessions,
  onNewChat,
  onNavigateChat,
  onNavigateRelationship,
  onNavigateMailMatch,
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
  /** Opens the source thread when the host has a mail/thread route available. */
  onNavigateMailMatch?: (threadId: string) => void;
  onOpenSettings: (section: SettingsSection) => void;
  onOpenAgent: (name: string) => void;
  onOpenSession: (runId: string) => void;
  onToggleSidebar: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [searchMode, setSearchMode] = React.useState<"accounts" | "mail">("accounts");
  const { setTheme } = useThemePreference();
  const term = debouncedQuery.trim();
  const searchEnabled = open && term.length >= 2;
  const accountsQuery = useRelationships({ q: term }, searchEnabled && searchMode === "accounts");
  const mailQuery = useSemanticSearch(term, searchEnabled && searchMode === "mail");
  const accounts = (accountsQuery.data ?? []).slice(0, 6);
  const mailMatches: SemanticMatch[] = (mailQuery.data?.matches ?? []).slice(0, 6);
  const semanticAvailable = mailQuery.data?.available ?? null;
  const searchError = accountsQuery.isError || mailQuery.isError;
  const searching = accountsQuery.isFetching || mailQuery.isFetching;

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const runAnd = (fn: () => void) => () => {
    fn();
    onOpenChange(false);
  };

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setSearchMode("accounts");
    }
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
        placeholder={
          searchMode === "mail"
            ? "Describe the mail evidence to find…"
            : "Search accounts, or type a command…"
        }
        value={query}
      />
      <div className="flex gap-1 border-b border-border px-3 py-2" aria-label="Search mode">
        <Button
          aria-pressed={searchMode === "accounts"}
          onClick={() => setSearchMode("accounts")}
          size="sm"
          type="button"
          variant={searchMode === "accounts" ? "secondary" : "ghost"}
        >
          Accounts
        </Button>
        <Button
          aria-pressed={searchMode === "mail"}
          onClick={() => setSearchMode("mail")}
          size="sm"
          type="button"
          variant={searchMode === "mail" ? "secondary" : "ghost"}
        >
          <EnvelopeSimple />
          Search mail
        </Button>
      </div>
      <CommandList>
        <CommandEmpty className="flex items-center justify-center gap-2">
          {searching ? (
            <>
              <Spinner className="size-4" />
              Searching…
            </>
          ) : searchError ? (
            "Search is temporarily unavailable."
          ) : searchMode === "mail" && semanticAvailable === false ? (
            "Semantic mail search is not enabled for this workspace."
          ) : (
            "No results found."
          )}
        </CommandEmpty>
        {mailMatches.length > 0 ? (
          <>
            <CommandGroup heading="Mail evidence">
              {mailMatches.map((match) => (
                <CommandItem
                  key={match.threadId}
                  onSelect={() => {
                    if (onNavigateMailMatch) {
                      runAnd(() => onNavigateMailMatch(match.threadId))();
                    }
                  }}
                  value={`${query} ${match.subject} ${match.counterparty}`}
                >
                  <EnvelopeSimple />
                  <span className="min-w-0">
                    <span className="block truncate">{match.subject}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {match.counterparty} · {match.classification} ·{" "}
                      {Math.round(match.score * 100)}%
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {match.summary}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}
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
                  <Label className="truncate font-normal">{session.title}</Label>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
