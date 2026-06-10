"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Server,
  Key,
  Shield,
  Palette,
  Loader2,
  CheckCircle2,
  Plus,
  X,
  Trash2,
  Wrench,
  Search,
  ChevronRight,
  Link2,
  Tags,
  Mail,
  BookOpen,
  User,
  Plug,
  HelpCircle,
  MessageCircle,
  MessageSquare,
  Bug,
  Terminal,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  AudioLines,
} from "@/lib/icons";

import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountSettings } from "@/components/settings/account-settings";
import { ConnectedAccountsSettings } from "@/components/settings/connected-accounts-settings";
import { TranscriptionSettings } from "@/components/settings/transcription-settings";
import { McpSettings } from "@/components/settings/mcp-settings";
import { SecuritySettings } from "@/components/settings/security-settings";
import { ModelSettings, SolomonModelSettings } from "@/components/settings/model-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { SettingsSection } from "@/components/settings/settings-ui";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { useSolomonAccount } from "@/hooks/useSolomonAccount";
import { PRODUCT_NAME, getProductProviderState } from "@x/shared/dist/branding.js";
import type { ApprovalPolicy } from "@x/shared/src/code-mode.js";

type ConfigTab =
  | "account"
  | "connections"
  | "models"
  | "transcription"
  | "mcp"
  | "security"
  | "code-mode"
  | "appearance"
  | "note-tagging"
  | "help";

type SettingsGroup = "account" | "workspace" | "advanced" | "help";

interface TabConfig {
  id: ConfigTab;
  label: string;
  icon: React.ElementType;
  path?: string;
  description: string;
  group: SettingsGroup;
}

const GROUP_LABELS: Record<SettingsGroup, string | null> = {
  account: "Account",
  workspace: "Workspace",
  advanced: "Advanced",
  help: null,
};

const GROUP_ORDER: SettingsGroup[] = ["account", "workspace", "advanced", "help"];

const tabs: TabConfig[] = [
  {
    id: "account",
    label: "Account",
    icon: User,
    description: `Manage your ${PRODUCT_NAME} account`,
    group: "account",
  },
  {
    id: "connections",
    label: "Connections",
    icon: Plug,
    description: "Manage accounts and tools",
    group: "account",
  },
  {
    id: "models",
    label: "Models",
    icon: Key,
    path: "config/models.json",
    description: "Configure LLM providers and API keys",
    group: "workspace",
  },
  {
    id: "transcription",
    label: "Transcription",
    icon: AudioLines,
    description: "Choose on-device or cloud speech-to-text",
    group: "workspace",
  },
  {
    id: "note-tagging",
    label: "Note Tagging",
    icon: Tags,
    path: "config/tags.json",
    description: "Configure tags for notes and emails",
    group: "workspace",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Customize the look and feel",
    group: "workspace",
  },
  {
    id: "mcp",
    label: "MCP Servers",
    icon: Server,
    path: "config/mcp.json",
    description: "Configure MCP server connections",
    group: "advanced",
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    path: "config/security.json",
    description: "Configure allowed shell commands and file access",
    group: "advanced",
  },
  {
    id: "code-mode",
    label: "Code Mode",
    icon: Terminal,
    description: "Delegate coding tasks to Claude Code or Codex",
    group: "advanced",
  },
  {
    id: "help",
    label: "Help",
    icon: HelpCircle,
    description: "Get help and support",
    group: "help",
  },
];

interface SettingsDialogProps {
  /** Optional trigger element. Omit when controlling `open` externally. */
  children?: React.ReactNode;
  /** Tab to open on when the dialog is shown. Defaults to "account". */
  defaultTab?: ConfigTab;
  /** Controlled open state. When provided, the dialog is fully controlled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// --- Help & Support tab ---

function HelpSettings() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { signedIn } = useSolomonAccount();
  const links = [
    {
      icon: Bug,
      wrap: "bg-destructive/10 text-destructive",
      title: "Report a bug",
      subtitle: "Open a GitHub issue",
      href: "https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/new",
    },
    {
      icon: MessageCircle,
      wrap: "bg-[#5865F2] text-white",
      title: "Join our Discord",
      subtitle: "Chat with the community",
      href: "https://discord.com/invite/wajrgmJQ6b",
    },
    {
      icon: Mail,
      wrap: "bg-muted text-foreground",
      title: "Contact us",
      subtitle: "contact@solomon-ai.co",
      href: "mailto:contact@solomon-ai.co",
    },
  ];
  return (
    <div className="space-y-6">
      <SettingsSection title="Get help" description="Reach the team or the community.">
        <div className="space-y-2">
          <button
            type="button"
            disabled={!signedIn}
            onClick={() => setFeedbackOpen(true)}
            className="group flex w-full items-center gap-3 rounded-none border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-none bg-primary/10 text-primary">
              <MessageSquare className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">Send feedback</span>
              <span className="block text-xs text-muted-foreground">
                {signedIn
                  ? `Reach the ${PRODUCT_NAME} team — we reply by email`
                  : "Sign in to send feedback"}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          </button>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
          {links.map((l) => (
            <button
              key={l.title}
              type="button"
              onClick={() => window.open(l.href, "_blank")}
              className="group flex w-full items-center gap-3 rounded-none border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-none",
                  l.wrap,
                )}
              >
                <l.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{l.title}</span>
                <span className="block text-xs text-muted-foreground">{l.subtitle}</span>
              </span>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="About">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <a
            href="https://www.solomon-ai.co/terms-of-service"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Terms of Service
          </a>
          <span>·</span>
          <a
            href="https://www.solomon-ai.co/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Privacy Policy
          </a>
        </div>
      </SettingsSection>
    </div>
  );
}

// --- Tools Library Settings ---

interface ToolkitInfo {
  slug: string;
  name: string;
  meta: {
    description: string;
    logo: string;
    tools_count: number;
    triggers_count: number;
  };
  no_auth?: boolean;
  auth_schemes?: string[];
  composio_managed_auth_schemes?: string[];
}

function ToolsLibrarySettings({
  dialogOpen,
  rowboatConnected,
}: {
  dialogOpen: boolean;
  rowboatConnected: boolean;
}) {
  // API key state
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  // Toolkit browsing state
  const [toolkits, setToolkits] = useState<ToolkitInfo[]>([]);
  const [toolkitsLoading, setToolkitsLoading] = useState(false);
  const [toolkitsUnavailableMessage, setToolkitsUnavailableMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Connection state
  const [connectedToolkits, setConnectedToolkits] = useState<Set<string>>(new Set());
  const [connectingToolkit, setConnectingToolkit] = useState<string | null>(null);

  // Check API key configuration
  const checkApiKey = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("composio:is-configured", null);
      setApiKeyConfigured(result.configured);
      if (!result.configured) {
        setShowApiKeyInput(true);
      }
    } catch {
      setApiKeyConfigured(false);
    }
  }, []);

  // Load connected toolkits
  const loadConnected = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("composio:list-connected", null);
      setConnectedToolkits(new Set(result.toolkits));
    } catch {
      // ignore
    }
  }, []);

  // Load toolkits
  const loadToolkits = useCallback(async () => {
    setToolkitsLoading(true);
    setToolkitsUnavailableMessage(null);
    try {
      const result = await window.ipc.invoke("composio:list-toolkits", {});
      setToolkits(result.items || []);
      if (result.providerConfigured === false) {
        setToolkitsUnavailableMessage(
          result.message || `Tool integrations are disabled for this ${PRODUCT_NAME} API.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.includes("provider_unconfigured") ||
        message.includes("composio not configured")
      ) {
        setToolkits([]);
        setToolkitsUnavailableMessage(
          `Tool integrations are disabled because this ${PRODUCT_NAME} API is running without Composio credentials.`,
        );
      } else {
        toast.error("Failed to load toolkits");
      }
    } finally {
      setToolkitsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!dialogOpen) return;
    checkApiKey();
    loadConnected();
  }, [dialogOpen, checkApiKey, loadConnected]);

  // Load toolkits when API key is configured
  useEffect(() => {
    if (dialogOpen && apiKeyConfigured) {
      loadToolkits();
    }
  }, [dialogOpen, apiKeyConfigured, loadToolkits]);

  // Listen for composio connection events
  useEffect(() => {
    const cleanup = window.ipc.on("composio:didConnect", (event) => {
      const { toolkitSlug, success, error } = event;
      setConnectingToolkit(null);
      if (success) {
        setConnectedToolkits((prev) => new Set([...prev, toolkitSlug]));
        toast.success(`Connected to ${toolkitSlug}`);
      } else {
        toast.error(error || `Failed to connect to ${toolkitSlug}`);
      }
    });
    return cleanup;
  }, []);

  // Save API key
  const handleSaveApiKey = async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setApiKeySaving(true);
    try {
      const result = await window.ipc.invoke("composio:set-api-key", {
        apiKey: trimmed,
      });
      if (result.success) {
        setApiKeyConfigured(true);
        setShowApiKeyInput(false);
        setApiKeyInput("");
        toast.success("Composio API key saved");
      } else {
        toast.error(result.error || "Failed to save API key");
      }
    } catch {
      toast.error("Failed to save API key");
    } finally {
      setApiKeySaving(false);
    }
  };

  // Connect a toolkit
  const handleConnect = async (toolkitSlug: string) => {
    setConnectingToolkit(toolkitSlug);
    try {
      const result = await window.ipc.invoke("composio:initiate-connection", {
        toolkitSlug,
      });
      if (!result.success) {
        toast.error(result.error || "Failed to connect");
        setConnectingToolkit(null);
      }
      // Success will be handled by composio:didConnect event
    } catch {
      toast.error("Failed to connect");
      setConnectingToolkit(null);
    }
  };

  // Disconnect a toolkit
  const handleDisconnect = async (toolkitSlug: string) => {
    try {
      await window.ipc.invoke("composio:disconnect", { toolkitSlug });
      setConnectedToolkits((prev) => {
        const next = new Set(prev);
        next.delete(toolkitSlug);
        return next;
      });
      toast.success(`Disconnected from ${toolkitSlug}`);
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  // Filter toolkits by search
  const filteredToolkits = searchQuery.trim()
    ? toolkits.filter(
        (t) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.meta.description.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : toolkits;

  return (
    <div className="space-y-4">
      {/* Section A: API Key (only in BYOK mode) */}
      {!rowboatConnected && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Composio API Key
          </span>
          {apiKeyConfigured && !showApiKeyInput ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle2 className="size-4" />
                API key configured
              </div>
              <button
                onClick={() => setShowApiKeyInput(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Enter your Composio API key to browse and enable tool integrations. Get your key
                from{" "}
                <a
                  href="https://app.composio.dev/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  app.composio.dev/settings
                </a>
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste your Composio API key"
                  onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
                  className="flex-1"
                />
                <Button
                  onClick={handleSaveApiKey}
                  disabled={!apiKeyInput.trim() || apiKeySaving}
                  size="sm"
                >
                  {apiKeySaving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                </Button>
                {apiKeyConfigured && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowApiKeyInput(false);
                      setApiKeyInput("");
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section B: Toolkit Browser (only when API key configured) */}
      {apiKeyConfigured && (
        <>
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Available Toolkits
            </span>
            {toolkitsUnavailableMessage && (
              <div className="flex gap-2 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{toolkitsUnavailableMessage}</span>
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search toolkits..."
                className="pl-8"
              />
            </div>
          </div>

          {toolkitsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin mr-2" />
              Loading toolkits...
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
              {filteredToolkits.map((toolkit) => {
                const isConnected = connectedToolkits.has(toolkit.slug);
                const isConnecting = connectingToolkit === toolkit.slug;

                return (
                  <div key={toolkit.slug} className="border rounded-none overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      {/* Logo */}
                      {toolkit.meta.logo ? (
                        <img
                          src={toolkit.meta.logo}
                          alt=""
                          className="size-7 rounded object-contain shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="size-7 rounded bg-muted flex items-center justify-center shrink-0">
                          <Wrench className="size-3.5 text-muted-foreground" />
                        </div>
                      )}

                      {/* Name & description */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{toolkit.name}</span>
                          {isConnected && (
                            <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">
                              Connected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {toolkit.meta.description}
                        </p>
                      </div>

                      {/* Connect / Disconnect button */}
                      {isConnected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDisconnect(toolkit.slug)}
                          className="text-xs h-7 shrink-0"
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleConnect(toolkit.slug)}
                          disabled={isConnecting}
                          className="text-xs h-7 shrink-0"
                        >
                          {isConnecting ? (
                            <>
                              <Loader2 className="size-3 animate-spin mr-1" />
                              Connecting...
                            </>
                          ) : (
                            <>
                              <Link2 className="size-3 mr-1" />
                              Connect
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {filteredToolkits.length === 0 && !toolkitsLoading && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  {searchQuery ? "No toolkits match your search" : "No toolkits available"}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Note Tagging Settings ---

interface TagDef {
  tag: string;
  type: string;
  applicability: "email" | "notes" | "both";
  description: string;
  example?: string;
  noteEffect?: "create" | "skip" | "none";
}

const NOTE_TAG_TYPE_ORDER = [
  "relationship",
  "relationship-sub",
  "topic",
  "action",
  "status",
  "source",
];

const EMAIL_TAG_TYPE_ORDER = ["relationship", "topic", "email-type", "noise", "action", "status"];

const TAG_TYPE_LABELS: Record<string, string> = {
  relationship: "Relationship",
  "relationship-sub": "Relationship Sub-Tags",
  topic: "Topic",
  "email-type": "Email Type",
  noise: "Noise",
  action: "Action",
  status: "Status",
  source: "Source",
};

function TagGroupTable({
  group,
  tags: _tags,
  collapsed,
  onToggle,
  onAdd,
  onUpdate,
  onRemove,
  getGlobalIndex,
  isEmail,
}: {
  group: { type: string; label: string; tags: TagDef[] };
  tags: TagDef[];
  collapsed: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onUpdate: (index: number, field: keyof TagDef, value: string | boolean) => void;
  onRemove: (index: number) => void;
  getGlobalIndex: (type: string, localIndex: number) => number;
  isEmail: boolean;
}) {
  const cols = isEmail ? "grid-cols-[110px_1fr_1fr_64px_28px]" : "grid-cols-[110px_1fr_1fr_28px]";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
          />
          {group.label}
          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
            {group.tags.length}
          </span>
        </button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={onAdd}>
          <Plus className="size-3" />
          Add
        </Button>
      </div>
      {!collapsed && group.tags.length > 0 && (
        <div className="overflow-hidden rounded-none border">
          <div
            className={cn(
              "grid gap-1 bg-muted/40 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
              cols,
            )}
          >
            <div>Label</div>
            <div>Description</div>
            <div>Example</div>
            {isEmail && (
              <div
                className="text-center"
                title="Emails with this label will be excluded from creating notes"
              >
                Skip note
              </div>
            )}
            <div />
          </div>
          {group.tags.map((tag, localIdx) => {
            const globalIdx = getGlobalIndex(group.type, localIdx);
            return (
              <div
                key={globalIdx}
                className={cn(
                  "grid items-center gap-1 border-t px-2.5 py-1 transition-colors hover:bg-muted/20",
                  cols,
                )}
              >
                <Input
                  value={tag.tag}
                  onChange={(e) => onUpdate(globalIdx, "tag", e.target.value)}
                  className="h-7 text-xs font-medium"
                  placeholder="tag-name"
                  title={tag.tag}
                />
                <Input
                  value={tag.description}
                  onChange={(e) => onUpdate(globalIdx, "description", e.target.value)}
                  className="h-7 text-xs"
                  placeholder="Description"
                  title={tag.description}
                />
                <Input
                  value={tag.example || ""}
                  onChange={(e) => onUpdate(globalIdx, "example", e.target.value)}
                  className="h-7 text-xs"
                  placeholder="Example"
                  title={tag.example || ""}
                />
                {isEmail && (
                  <div className="flex justify-center">
                    <Switch
                      checked={tag.noteEffect === "skip"}
                      onCheckedChange={(checked) =>
                        onUpdate(globalIdx, "noteEffect", checked ? "skip" : "create")
                      }
                      className="scale-75"
                    />
                  </div>
                )}
                <button
                  onClick={() => onRemove(globalIdx)}
                  className="flex items-center justify-center text-muted-foreground transition-colors hover:text-destructive"
                  aria-label="Remove tag"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {!collapsed && group.tags.length === 0 && (
        <button
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 rounded-none border border-dashed py-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add a {group.label.toLowerCase()} tag
        </button>
      )}
    </div>
  );
}

function NoteTaggingSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [tags, setTags] = useState<TagDef[]>([]);
  const [originalTags, setOriginalTags] = useState<TagDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<"notes" | "email">("notes");

  const hasChanges = JSON.stringify(tags) !== JSON.stringify(originalTags);

  useEffect(() => {
    if (!dialogOpen) return;
    async function load() {
      setLoading(true);
      try {
        const result = await window.ipc.invoke("workspace:readFile", {
          path: "config/tags.json",
        });
        const parsed = JSON.parse(result.data);
        setTags(parsed);
        setOriginalTags(parsed);
      } catch {
        setTags([]);
        setOriginalTags([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dialogOpen]);

  const noteGroups = useMemo(() => {
    const map = new Map<string, TagDef[]>();
    for (const tag of tags) {
      if (tag.applicability === "email") continue;
      const list = map.get(tag.type) ?? [];
      list.push(tag);
      map.set(tag.type, list);
    }
    return NOTE_TAG_TYPE_ORDER.filter((type) => map.has(type)).map((type) => ({
      type,
      label: TAG_TYPE_LABELS[type],
      tags: map.get(type) ?? [],
    }));
  }, [tags]);

  const emailGroups = useMemo(() => {
    const map = new Map<string, TagDef[]>();
    for (const tag of tags) {
      if (tag.applicability === "notes") continue;
      const list = map.get(tag.type) ?? [];
      list.push(tag);
      map.set(tag.type, list);
    }
    return EMAIL_TAG_TYPE_ORDER.filter((type) => map.has(type)).map((type) => ({
      type,
      label: TAG_TYPE_LABELS[type],
      tags: map.get(type) ?? [],
    }));
  }, [tags]);

  const getGlobalIndex = useCallback(
    (type: string, localIndex: number) => {
      let count = 0;
      for (let i = 0; i < tags.length; i++) {
        if (tags[i].type === type) {
          if (count === localIndex) return i;
          count++;
        }
      }
      return -1;
    },
    [tags],
  );

  const updateTag = useCallback((index: number, field: keyof TagDef, value: string | boolean) => {
    setTags((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }, []);

  const removeTag = useCallback((index: number) => {
    setTags((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addTag = useCallback(
    (type: string) => {
      const isEmailSection = activeSection === "email";
      const applicability = isEmailSection ? ("email" as const) : ("notes" as const);
      // For email-only types, always use "email"; for notes-only types, always use "notes"; otherwise use "both"
      const emailOnlyTypes = ["email-type", "noise"];
      const notesOnlyTypes = ["relationship-sub", "source"];
      let finalApplicability: "email" | "notes" | "both" = "both";
      if (emailOnlyTypes.includes(type)) finalApplicability = "email";
      else if (notesOnlyTypes.includes(type)) finalApplicability = "notes";
      else finalApplicability = isEmailSection ? "email" : applicability;

      const newTag: TagDef = {
        tag: "",
        type,
        applicability:
          finalApplicability === "email" && !isEmailSection
            ? "both"
            : finalApplicability === "notes" && isEmailSection
              ? "both"
              : finalApplicability,
        description: "",
        noteEffect: isEmailSection ? "create" : "none",
      };
      const lastIndex = tags.reduce((acc, t, i) => (t.type === type ? i : acc), -1);
      if (lastIndex === -1) {
        setTags((prev) => [...prev, newTag]);
      } else {
        setTags((prev) => [...prev.slice(0, lastIndex + 1), newTag, ...prev.slice(lastIndex + 1)]);
      }
    },
    [tags, activeSection],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await window.ipc.invoke("workspace:writeFile", {
        path: "config/tags.json",
        data: JSON.stringify(tags, null, 2),
      });
      setOriginalTags([...tags]);
      toast.success("Tag configuration saved");
    } catch {
      toast.error("Failed to save tag configuration");
    } finally {
      setSaving(false);
    }
  }, [tags]);

  const toggleGroup = useCallback((type: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  const currentGroups = activeSection === "notes" ? noteGroups : emailGroups;

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 shrink-0">
        <div className="inline-flex rounded-none border bg-muted/40 p-0.5">
          {(
            [
              { id: "notes", label: "Note Tags", icon: BookOpen },
              { id: "email", label: "Email Labels", icon: Mail },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-none px-3 py-1.5 text-xs font-medium transition-colors",
                activeSection === s.id
                  ? "bg-background text-foreground shadow-[0_1px_2px_rgb(16_24_40_/_0.06)] ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <s.icon className="size-3.5" />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
        {currentGroups.map((group) => (
          <TagGroupTable
            key={group.type}
            group={group}
            tags={tags}
            collapsed={collapsedGroups.has(group.type)}
            onToggle={() => toggleGroup(group.type)}
            onAdd={() => addTag(group.type)}
            onUpdate={updateTag}
            onRemove={removeTag}
            getGlobalIndex={getGlobalIndex}
            isEmail={activeSection === "email"}
          />
        ))}
      </div>
      <div className="pt-3 border-t mt-3 flex items-center justify-between">
        <div>
          {hasChanges && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Code Mode Settings ---

type AgentStatus = { installed: boolean; signedIn: boolean };
type CodeModeAgentStatus = { claude: AgentStatus; codex: AgentStatus };

function AgentStatusRow({
  name,
  installLink,
  signInCommand,
  status,
}: {
  name: string;
  installLink: string;
  signInCommand: string;
  status: AgentStatus | null;
}) {
  const ready = status?.installed && status?.signedIn;
  const needsSignInOnly = status?.installed && !status?.signedIn;
  const pill = (ok: boolean, label: string) => (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        ok
          ? "bg-green-500/10 text-green-600 dark:text-green-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {ok ? <CheckCircle2 className="size-2.5" /> : <X className="size-2.5" />}
      {label}
    </span>
  );
  return (
    <div className="flex items-center gap-3 rounded-none border bg-card px-3.5 py-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-none border",
          ready
            ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
            : "bg-muted/40 text-muted-foreground",
        )}
      >
        <Terminal className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{name}</div>
        <div className="mt-1 flex items-center gap-1.5">
          {pill(!!status?.installed, "Installed")}
          {pill(!!status?.signedIn, "Signed in")}
        </div>
      </div>
      {ready ? (
        <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium leading-none text-green-600 dark:text-green-400">
          Ready
        </span>
      ) : needsSignInOnly ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          Run{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
            {signInCommand}
          </code>
        </span>
      ) : (
        <a
          href={installLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Install
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

function CodeModeSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("ask");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CodeModeAgentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const result = await window.ipc.invoke("codeMode:checkAgentStatus", null);
      setStatus(result);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await window.ipc.invoke("codeMode:getConfig", null);
        if (!cancelled) {
          setEnabled(result.enabled);
          setApprovalPolicy(result.approvalPolicy ?? "ask");
        }
      } catch {
        if (!cancelled) setEnabled(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, loadStatus]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      setSaving(true);
      setEnabled(next);
      try {
        await window.ipc.invoke("codeMode:setConfig", {
          enabled: next,
          approvalPolicy,
        });
        window.dispatchEvent(new Event("code-mode-config-changed"));
        toast.success(next ? "Code mode enabled" : "Code mode disabled");
      } catch {
        setEnabled(!next);
        toast.error("Failed to update code mode");
      } finally {
        setSaving(false);
      }
    },
    [approvalPolicy],
  );

  const handlePolicyChange = useCallback(
    async (next: ApprovalPolicy) => {
      const prev = approvalPolicy;
      setSaving(true);
      setApprovalPolicy(next);
      try {
        await window.ipc.invoke("codeMode:setConfig", {
          enabled,
          approvalPolicy: next,
        });
        window.dispatchEvent(new Event("code-mode-config-changed"));
      } catch {
        setApprovalPolicy(prev);
        toast.error("Failed to update approval policy");
      } finally {
        setSaving(false);
      }
    },
    [enabled, approvalPolicy],
  );

  const anyReady =
    (status?.claude.installed && status?.claude.signedIn) ||
    (status?.codex.installed && status?.codex.signedIn);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  const APPROVAL_OPTIONS = [
    {
      value: "ask",
      label: "Ask every time",
      desc: "You approve every file change and command the agent wants to run.",
    },
    {
      value: "auto-approve-reads",
      label: "Auto-approve reads",
      desc: "Reading and searching run automatically; you still approve writes, edits, and commands.",
    },
    {
      value: "yolo",
      label: "Auto-approve everything (YOLO)",
      desc: "The agent runs everything — writes, edits, and commands — without asking. Use only in folders you trust.",
    },
  ] as const;

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Code mode</strong> lets the assistant delegate coding
        tasks to <strong className="text-foreground">Claude Code</strong> or{" "}
        <strong className="text-foreground">Codex</strong> running on your machine. Pick the agent
        inline from the composer; the assistant runs it on-device and streams its work — tool calls,
        file diffs, and approvals — back into chat. Requires an active Claude Code or ChatGPT/Codex
        subscription; you can have one or both.
      </p>

      <SettingsSection
        title="Agents"
        description="At least one must be installed and signed in to use code mode."
        action={
          <button
            onClick={() => {
              void loadStatus();
            }}
            disabled={statusLoading}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {statusLoading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Re-check
          </button>
        }
      >
        <div className="space-y-2">
          <AgentStatusRow
            name="Claude Code"
            installLink="https://claude.ai/code"
            signInCommand="claude login"
            status={status?.claude ?? null}
          />
          <AgentStatusRow
            name="Codex"
            installLink="https://developers.openai.com/codex/cli"
            signInCommand="codex login"
            status={status?.codex ?? null}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Code mode">
        <div className="flex items-start gap-3 rounded-none border bg-card px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">Enable code mode</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Shows the code mode chip in the composer and lets the assistant delegate to your
              installed agents.
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} disabled={saving} />
        </div>
      </SettingsSection>

      {enabled && (
        <SettingsSection
          title="Approvals"
          description="How the coding agent checks in before changing files or running commands. You always see everything it does in the timeline — this only controls the prompts."
        >
          <div className="space-y-2">
            {APPROVAL_OPTIONS.map((opt) => {
              const active = approvalPolicy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => handlePolicyChange(opt.value as ApprovalPolicy)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-none border px-3.5 py-3 text-left transition-all",
                    active
                      ? "border-primary bg-primary/[0.03] ring-2 ring-primary/20"
                      : "border-border hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      active ? "border-primary" : "border-muted-foreground/40",
                    )}
                  >
                    {active && <span className="size-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{opt.label}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {opt.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsSection>
      )}

      {enabled && status && !anyReady && (
        <div className="flex items-start gap-2 rounded-none border border-amber-500/40 bg-amber-50/60 px-3 py-2.5 text-xs dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <div className="text-amber-900 dark:text-amber-200">
            Neither Claude Code nor Codex is ready. Install at least one and sign in with a
            subscription account, then click Re-check.
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Settings Dialog ---

export function SettingsDialog({
  children,
  defaultTab = "account",
  open: controlledOpen,
  onOpenChange,
}: SettingsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setInternalOpen(next);
    },
    [onOpenChange],
  );
  const [activeTab, setActiveTab] = useState<ConfigTab>(defaultTab);
  const [solomonConnected, setSolomonConnected] = useState(false);

  // Reset to the requested default tab each time the dialog is opened
  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  // Check if user is signed in to Solomon AI
  useEffect(() => {
    if (!open) return;
    window.ipc
      .invoke("oauth:getState", null)
      .then((result) => {
        const connected = getProductProviderState(result.config)?.connected ?? false;
        setSolomonConnected(connected);
      })
      .catch(() => {
        setSolomonConnected(false);
      });
  }, [open]);

  const visibleTabs = useMemo(
    () => (solomonConnected ? tabs.filter((t) => t.id !== "models") : tabs),
    [solomonConnected],
  );

  const activeTabConfig = visibleTabs.find((t) => t.id === activeTab) ?? visibleTabs[0];

  const ActiveIcon = activeTabConfig.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="rowboat-settings w-[1000px]! max-w-[96vw]! h-[660px] max-h-[88vh] p-0 gap-0 overflow-hidden">
        <div className="flex h-full overflow-hidden">
          {/* Sidebar nav — grouped, ElevenLabs developer-console rail */}
          <div className="flex w-60 shrink-0 flex-col border-r bg-muted/20">
            <div className="px-4 pb-1 pt-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Settings
              </h2>
            </div>
            <ScrollArea className="flex-1 px-2.5 pb-3">
              {GROUP_ORDER.map((group) => {
                const groupTabs = visibleTabs.filter((t) => t.group === group);
                if (groupTabs.length === 0) return null;
                const groupLabel = GROUP_LABELS[group];
                return (
                  <div key={group} className="mb-1 mt-2 first:mt-1">
                    {groupLabel && (
                      <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {groupLabel}
                      </div>
                    )}
                    <nav className="flex flex-col gap-0.5">
                      {groupTabs.map((tab) => {
                        const active = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                              "group flex items-center gap-2.5 rounded-none px-2.5 py-2 text-sm font-medium text-left transition-colors",
                              active
                                ? "bg-background text-foreground ring-1 ring-border shadow-[0_1px_2px_rgb(16_24_40_/_0.06)]"
                                : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                            )}
                          >
                            <tab.icon
                              className={cn(
                                "size-4 shrink-0 transition-colors",
                                active
                                  ? "text-foreground"
                                  : "text-muted-foreground group-hover:text-foreground",
                              )}
                            />
                            {tab.label}
                          </button>
                        );
                      })}
                    </nav>
                  </div>
                );
              })}
            </ScrollArea>
          </div>

          {/* Main content */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 border-b px-6 py-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-none border bg-card text-foreground">
                <ActiveIcon className="size-[18px]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold tracking-tight">
                  {activeTabConfig.label}
                </h3>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {activeTab === "models" && solomonConnected
                    ? "Select your default models"
                    : activeTabConfig.description}
                </p>
              </div>
            </div>

            {/* Content — animated per-tab */}
            <div className="min-h-0 flex-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="flex h-full min-h-0 flex-col"
                >
                  {activeTab === "note-tagging" ? (
                    // NoteTaggingSettings owns its own internal scroll.
                    <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
                      <NoteTaggingSettings dialogOpen={open} />
                    </div>
                  ) : (
                    <ScrollArea className="flex-1 px-6 py-5">
                      {activeTab === "account" ? (
                        <AccountSettings dialogOpen={open} />
                      ) : activeTab === "connections" ? (
                        <div className="space-y-6">
                          <SettingsSection title="Primary accounts">
                            <ConnectedAccountsSettings dialogOpen={open} />
                          </SettingsSection>
                          <Separator />
                          <SettingsSection title="Library">
                            <ToolsLibrarySettings
                              dialogOpen={open}
                              rowboatConnected={solomonConnected}
                            />
                          </SettingsSection>
                        </div>
                      ) : activeTab === "models" ? (
                        solomonConnected ? (
                          <SolomonModelSettings dialogOpen={open} />
                        ) : (
                          <ModelSettings dialogOpen={open} />
                        )
                      ) : activeTab === "transcription" ? (
                        <TranscriptionSettings dialogOpen={open} />
                      ) : activeTab === "appearance" ? (
                        <AppearanceSettings />
                      ) : activeTab === "help" ? (
                        <HelpSettings />
                      ) : activeTab === "code-mode" ? (
                        <CodeModeSettings dialogOpen={open} />
                      ) : activeTab === "mcp" ? (
                        <McpSettings dialogOpen={open} />
                      ) : activeTab === "security" ? (
                        <SecuritySettings dialogOpen={open} />
                      ) : null}
                    </ScrollArea>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
