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
import type { SessionMeta } from "@/lib/chat-sessions";
import { listRelationships, semanticSearch, type SemanticMatch } from "@/lib/revenue";
import type { RevenueRelationship } from "@/types/revenue";

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
  const [searchMode, setSearchMode] = React.useState<"accounts" | "mail">("accounts");
  const [accounts, setAccounts] = React.useState<RevenueRelationship[]>([]);
  const [mailMatches, setMailMatches] = React.useState<SemanticMatch[]>([]);
  const [semanticAvailable, setSemanticAvailable] = React.useState<boolean | null>(null);
  const [searchError, setSearchError] = React.useState(false);
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
      setMailMatches([]);
      setSemanticAvailable(null);
      setSearchError(false);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      const request =
        searchMode === "mail"
          ? semanticSearch(term, controller.signal).then((result) => {
              setSemanticAvailable(result.available);
              setMailMatches(result.matches.slice(0, 6));
              setAccounts([]);
            })
          : listRelationships({ q: term }, controller.signal).then((rows) => {
              setAccounts(rows.slice(0, 6));
              setMailMatches([]);
              setSemanticAvailable(null);
            });
      void request
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (!controller.signal.aborted) {
            setAccounts([]);
            setMailMatches([]);
            setSearchError(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, searchMode]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
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
