"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Server,
  Key,
  Lock,
  Shield,
  Palette,
  Loader2,
  CheckCircle2,
  Plus,
  X,
  Trash2,
  Search,
  ChevronRight,
  Link2,
  Tags,
  BrainIcon,
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
  Bell,
  ArrowLeft,
  Cloud,
  Download,
  LayoutGridIcon,
  RotateCcw,
  Settings,
} from "@/lib/icons";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@oppulence/ui/components/dialog";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import { Separator } from "@oppulence/ui/components/separator";
import { Switch } from "@oppulence/ui/components/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AccountSettings } from "@/components/settings/account-settings";
import { ConnectedAccountsSettings } from "@/components/settings/connected-accounts-settings";
import { TranscriptionSettings } from "@/components/settings/transcription-settings";
import { McpSettings } from "@/components/settings/mcp-settings";
import { SecuritySettings } from "@/components/settings/security-settings";
import { ModelSettings, SolomonModelSettings } from "@/components/settings/model-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { MemorySettings } from "@/components/settings/memory-settings";
import { RecoverySettings } from "@/components/settings/recovery-settings";
import { SettingsSection } from "@/components/settings/settings-ui";
import { PrivacySettings } from "@/components/settings/privacy-settings";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { IntegrationApiKeyModal } from "@/components/integration-api-key-modal";
import { useConnectors } from "@/hooks/useConnectors";
import { useSolomonAccount } from "@/hooks/useSolomonAccount";
import { PRODUCT_NAME, getProductProviderState } from "@x/shared/dist/branding.js";
import type { ApprovalPolicy } from "@x/shared/src/code-mode.js";
import settingsWorkspacePreview from "../../../../../rowboat-www/public/marketing/desktop-home.png";

type ConfigTab =
  | "overview"
  | "preferences"
  | "notifications"
  | "permissions"
  | "privacy"
  | "security"
  | "extensions"
  | "connections"
  | "transcription"
  | "note-tagging"
  | "advanced"
  | "customization"
  | "code-mode"
  | "mcp"
  | "environment"
  | "updates"
  | "memory"
  | "recovery"
  | "account"
  | "connect"
  | "models"
  | "appearance"
  | "help";

type SettingsGroup = "workspace" | "global" | "cloud" | "support";

interface TabConfig {
  id: ConfigTab;
  label: string;
  icon: React.ElementType;
  path?: string;
  description: string;
  group?: SettingsGroup;
  beta?: boolean;
  keywords?: readonly string[];
}

const GROUP_LABELS: Record<SettingsGroup, string> = {
  workspace: "Workspace",
  global: "Global",
  cloud: "Cloud",
  support: "Support",
};

const GROUP_ORDER: SettingsGroup[] = ["workspace", "global", "cloud", "support"];

const tabs: TabConfig[] = [
  {
    id: "overview",
    label: "Settings",
    icon: Settings,
    description: "Everything that shapes your workspace and account.",
  },
  {
    id: "preferences",
    label: "Preferences",
    icon: Bell,
    description: "Default model, reasoning, notifications, privacy, and memory.",
    group: "workspace",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    description: "Configure system notification preferences.",
    group: "workspace",
    keywords: ["alerts", "banners", "system notifications"],
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: Shield,
    description: "Control file, command, and workspace access.",
    group: "workspace",
    keywords: ["microphone", "audio", "screen recording", "camera", "files", "commands"],
  },
  {
    id: "privacy",
    label: "Privacy & data",
    icon: Lock,
    description: "What is stored on this Mac, what leaves it, and how to delete it.",
    group: "workspace",
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    path: "config/security.json",
    description: "Configure allowed shell commands and file access.",
    group: "workspace",
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Plug,
    description: "Connect services, skills, and local MCP servers.",
    group: "workspace",
  },
  {
    id: "connections",
    label: "Connections",
    icon: Plug,
    description: "Manage connected accounts and available tools.",
    group: "workspace",
  },
  {
    id: "transcription",
    label: "Transcription",
    icon: AudioLines,
    description: "Choose on-device or cloud speech-to-text.",
    group: "workspace",
    keywords: ["microphone", "audio input", "recording", "speech", "voice", "meeting"],
  },
  {
    id: "note-tagging",
    label: "Note Tagging",
    icon: Tags,
    path: "config/tags.json",
    description: "Configure tags for notes and emails.",
    group: "workspace",
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: Terminal,
    description: "Configure desktop intelligence and agent execution.",
    group: "workspace",
  },
  {
    id: "models",
    label: "AI Providers",
    icon: Key,
    path: "config/models.json",
    description: "Choose the models that reason over relationship evidence.",
    group: "global",
  },
  {
    id: "code-mode",
    label: "Code Mode",
    icon: Terminal,
    description: "Delegate coding tasks to Claude Code or Codex.",
    group: "global",
  },
  {
    id: "customization",
    label: "Customization",
    icon: LayoutGridIcon,
    description: "Tune product branding, navigation, and workspace layout.",
    group: "global",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Set theme, layout, and window preferences.",
    group: "global",
  },
  {
    id: "mcp",
    label: "MCP Servers",
    icon: Server,
    path: "config/mcp.json",
    description: "Configure MCP server connections.",
    group: "global",
  },
  {
    id: "environment",
    label: "Environment",
    icon: Server,
    description: "Review the local runtime and service endpoints.",
    group: "global",
  },
  {
    id: "updates",
    label: "Updates",
    icon: Download,
    description: "Keep the desktop app current with controlled releases.",
    group: "global",
  },
  {
    id: "memory",
    label: "Memory",
    icon: BrainIcon,
    path: "config/index.json",
    description: "Manage the semantic index over your knowledge vault.",
    group: "global",
    keywords: ["semantic search", "recall", "index", "embeddings", "knowledge"],
  },
  {
    id: "recovery",
    label: "Recovery",
    icon: RotateCcw,
    description: "Diagnose local data and rebuild semantic memory.",
    group: "global",
    keywords: ["repair", "reset", "rebuild", "diagnostics", "broken", "index"],
  },
  {
    id: "account",
    label: "Account",
    icon: User,
    description: `Manage your ${PRODUCT_NAME} account`,
    group: "cloud",
  },
  {
    id: "connect",
    label: "Oppulence Connect",
    icon: Cloud,
    description: "Use organization-approved shared cloud connections.",
    group: "cloud",
    beta: true,
  },
  {
    id: "help",
    label: "Help",
    icon: HelpCircle,
    description: "Get help and support.",
    group: "support",
  },
];

interface SettingsDialogProps {
  /** Optional trigger element. Omit when controlling `open` externally. */
  children?: React.ReactNode;
  /** Section to open on when the dialog is shown. Defaults to the overview. */
  defaultTab?: ConfigTab;
  /** Controlled open state. When provided, the dialog is fully controlled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Restart the guided product tour from Help. */
  onStartTour?: () => void;
}

// --- Help & Support tab ---

function HelpSettings({ onStartTour }: { onStartTour?: () => void }) {
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
      subtitle: "hello@oppulence.io",
      href: "mailto:hello@oppulence.io",
    },
  ];
  return (
    <div className="space-y-6">
      <SettingsSection title="Get help" description="Reach the team or the community.">
        <div className="space-y-2">
          {onStartTour ? (
            <button
              type="button"
              onClick={onStartTour}
              className="group flex w-full items-center gap-3 rounded-none border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-none bg-primary/10 text-primary">
                <HelpCircle className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">Take product tour</span>
                <span className="block text-xs text-muted-foreground">
                  Walk through accounts, evidence, actions, and approvals
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>
          ) : null}
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
            href="https://oppulence.io/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Terms of Service
          </a>
          <span>·</span>
          <a
            href="https://oppulence.io/privacy"
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

function ToolsLibrarySettings({
  dialogOpen,
  rowboatConnected,
}: {
  dialogOpen: boolean;
  rowboatConnected: boolean;
}) {
  const c = useConnectors(dialogOpen);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredIntegrations = searchQuery.trim()
    ? c.integrations.filter(
        (integration) =>
          integration.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          integration.description.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : c.integrations;

  return (
    <div className="space-y-4">
      <IntegrationApiKeyModal
        open={c.integrationApiKeyOpen}
        onOpenChange={c.setIntegrationApiKeyOpen}
        onSubmit={c.handleIntegrationApiKeySubmit}
        isSubmitting={c.integrationApiKeySubmitting}
        integrationName={c.integrationApiKeyTarget?.displayName}
      />

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Available Integrations
        </span>
        {!rowboatConnected && (
          <div className="flex gap-2 rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Sign in to {PRODUCT_NAME} to connect managed integrations.</span>
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search integrations..."
            className="pl-8"
          />
        </div>
      </div>

      {c.integrationsLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading integrations...
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
          {filteredIntegrations.map((integration) => {
            const isConnecting = c.integrationConnecting[integration.name] ?? false;
            const blocks = integration.templateBlocks ?? [];

            return (
              <div key={integration.name} className="border rounded-none overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="size-7 rounded bg-muted flex items-center justify-center shrink-0">
                    <Plug className="size-3.5 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">
                        {integration.displayName}
                      </span>
                      {integration.connected && (
                        <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {integration.description}
                    </p>
                    {blocks.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {blocks.slice(0, 3).map((block) => (
                          <span
                            key={block.id}
                            className="border border-border px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground"
                          >
                            {block.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {integration.connected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => c.handleDisconnectIntegration(integration)}
                      disabled={isConnecting}
                      className="text-xs h-7 shrink-0"
                      aria-label={`Disconnect ${integration.displayName}`}
                    >
                      {isConnecting ? <Loader2 className="size-3 animate-spin" /> : "Disconnect"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => c.handleConnectIntegration(integration)}
                      disabled={isConnecting || !rowboatConnected}
                      className="text-xs h-7 shrink-0"
                      aria-label={`Connect ${integration.displayName}`}
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="mr-1 size-3 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Link2 className="mr-1 size-3" />
                          Connect
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredIntegrations.length === 0 && !c.integrationsLoading && (
            <div className="text-center py-6 text-sm text-muted-foreground">
              {searchQuery ? "No integrations match your search" : "No integrations available"}
            </div>
          )}
        </div>
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
          aria-label={`Add ${group.label.toLowerCase()} tag`}
          className="flex w-full items-center justify-center gap-1.5 rounded-none border border-dashed py-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add tag
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
    return NOTE_TAG_TYPE_ORDER.map((type) => ({
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
    return EMAIL_TAG_TYPE_ORDER.map((type) => ({
      type,
      label: TAG_TYPE_LABELS[type],
      tags: map.get(type) ?? [],
    }));
  }, [tags]);

  const getGlobalIndex = useCallback(
    (type: string, localIndex: number) => {
      let count = 0;
      for (let i = 0; i < tags.length; i++) {
        if (
          tags[i].type === type &&
          (activeSection === "notes"
            ? tags[i].applicability !== "email"
            : tags[i].applicability !== "notes")
        ) {
          if (count === localIndex) return i;
          count++;
        }
      }
      return -1;
    },
    [tags, activeSection],
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
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={saving}
            aria-label="Enable code mode"
          />
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

function useStoredBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "true";
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      localStorage.setItem(key, String(next));
    },
    [key],
  );

  return [value, update] as const;
}

function SettingsPage({
  title,
  description,
  wide,
  children,
}: {
  title: string;
  description: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("settings-page", wide && "settings-page--wide")}>
      <h1 className="settings-page-title">{title}</h1>
      <p className="settings-page-description">{description}</p>
      <hr className="settings-divider" />
      {children}
    </div>
  );
}

function SettingsOverview({ onNavigate }: { onNavigate: (tab: ConfigTab) => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const commonTaskIds: ConfigTab[] = [
    "connections",
    "transcription",
    "privacy",
    "models",
    "appearance",
    "permissions",
  ];
  const results = tabs.filter(
    (tab) =>
      tab.id !== "overview" &&
      (!normalizedQuery ||
        `${tab.label} ${tab.description} ${tab.group || ""} ${(tab.keywords ?? []).join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery)),
  );
  const visibleCards = normalizedQuery
    ? results
    : commonTaskIds
        .map((id) => tabs.find((tab) => tab.id === id))
        .filter((tab): tab is TabConfig => Boolean(tab));

  return (
    <SettingsPage
      description="Configure how Oppulence reasons, connects, and acts across every customer relationship."
      title="Settings"
      wide
    >
      <div className="relative mb-6 max-w-xl">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
          className="pl-9"
        />
      </div>
      <section className="settings-overview-group">
        <h2 className="settings-overview-label">
          {normalizedQuery
            ? `${results.length} result${results.length === 1 ? "" : "s"}`
            : "Common tasks"}
        </h2>
        {visibleCards.length ? (
          <div className="settings-card-grid">
            {visibleCards.map((tab) => (
              <button
                className="settings-card"
                key={tab.id}
                onClick={() => onNavigate(tab.id)}
                type="button"
              >
                <span className="settings-card-icon">
                  <tab.icon />
                </span>
                <span className="settings-card-copy">
                  <span className="settings-card-title">{tab.label}</span>
                  <span className="settings-card-description">{tab.description}</span>
                </span>
                <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/50" />
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            No settings match “{query}”. Try a provider, permission, transcription, or appearance.
          </p>
        )}
      </section>
      {!normalizedQuery ? (
        <p className="mt-6 max-w-xl text-xs leading-5 text-muted-foreground">
          Every setting remains available in the navigation. Start here for the tasks people use
          most, or search by what you want to change.
        </p>
      ) : null}
    </SettingsPage>
  );
}

function DesktopPreferenceToggles() {
  const [reasoning, setReasoning] = useStoredBoolean("settings-show-model-reasoning", true);
  const [compaction, setCompaction] = useStoredBoolean("settings-auto-context-compaction", true);
  const [analytics, setAnalytics] = useStoredBoolean("settings-share-usage", true);
  const [memory, setMemory] = useStoredBoolean("settings-memory-bank", false);
  const options = [
    {
      value: reasoning,
      setValue: setReasoning,
      label: "Show model reasoning",
      description: "Show the reasoning trace behind relationship recommendations.",
    },
    {
      value: compaction,
      setValue: setCompaction,
      label: "Auto context compaction",
      description: "Compress older evidence automatically as working context grows.",
    },
    {
      value: analytics,
      setValue: setAnalytics,
      label: "Share anonymous usage data",
      description: "Help improve the product without sharing relationship content.",
    },
    {
      value: memory,
      setValue: setMemory,
      label: "Memory Bank (preview)",
      description: "Build a private semantic memory from approved relationship evidence.",
    },
  ];

  return (
    <div className="settings-panel">
      {options.map((option) => (
        <div className="settings-row" key={option.label}>
          <div className="settings-row-copy">
            <p className="settings-row-label">{option.label}</p>
            <p className="settings-row-description">{option.description}</p>
          </div>
          <button
            aria-checked={option.value}
            aria-label={option.label}
            className="settings-switch shrink-0"
            onClick={() => option.setValue(!option.value)}
            role="switch"
            type="button"
          />
        </div>
      ))}
    </div>
  );
}

function CustomizationSettings() {
  const [appName, setAppName] = useState(PRODUCT_NAME);
  const [savedName, setSavedName] = useState(PRODUCT_NAME);
  const [sidebar, setSidebar] = useStoredBoolean("settings-display-sidebar", true);
  const [statusBar, setStatusBar] = useStoredBoolean("settings-display-status-bar", true);
  const [docs, setDocs] = useStoredBoolean("settings-display-docs", true);
  const [feedback, setFeedback] = useStoredBoolean("settings-display-feedback", true);
  const options = [
    {
      value: sidebar,
      setValue: setSidebar,
      label: "Display sidebar",
      description: "Keep relationship navigation visible.",
    },
    {
      value: statusBar,
      setValue: setStatusBar,
      label: "Display status bar",
      description: "Show local service and synchronization state.",
    },
    {
      value: docs,
      setValue: setDocs,
      label: "Display documentation link",
      description: "Keep product documentation available from the app rail.",
    },
    {
      value: feedback,
      setValue: setFeedback,
      label: "Display feedback button",
      description: "Make feedback available to everyone using this device.",
    },
  ];

  useEffect(() => {
    const stored = localStorage.getItem("settings-app-name") || PRODUCT_NAME;
    setAppName(stored);
    setSavedName(stored);
  }, []);

  return (
    <div className="space-y-7">
      <SettingsSection title="Branding" description="Set the local workspace label on this device.">
        <div className="settings-panel p-4">
          <label className="settings-row-label" htmlFor="desktop-settings-app-name">
            App name
          </label>
          <div className="mt-2 flex gap-2">
            <input
              className="settings-control min-w-0 flex-1"
              id="desktop-settings-app-name"
              onChange={(event) => setAppName(event.target.value)}
              value={appName}
            />
            <button
              className="settings-button settings-button--primary"
              disabled={appName.trim() === savedName}
              onClick={() => {
                const next = appName.trim() || PRODUCT_NAME;
                localStorage.setItem("settings-app-name", next);
                setAppName(next);
                setSavedName(next);
              }}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Layout"
        description="Preview the same relationship workspace available in the web app."
      >
        <div className="settings-preview">
          <img alt="Oppulence relationship workspace" src={settingsWorkspacePreview} />
        </div>
        <div className="settings-panel mt-3">
          {options.map((option) => (
            <div className="settings-row" key={option.label}>
              <div className="settings-row-copy">
                <p className="settings-row-label">{option.label}</p>
                <p className="settings-row-description">{option.description}</p>
              </div>
              <button
                aria-checked={option.value}
                aria-label={option.label}
                className="settings-switch"
                onClick={() => option.setValue(!option.value)}
                role="switch"
                type="button"
              />
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

function DesktopEnvironmentSettings() {
  const [versions, setVersions] = useState<{
    chrome: string;
    node: string;
    electron: string;
  } | null>(null);

  useEffect(() => {
    void window.ipc.invoke("app:getVersions", null).then(setVersions);
  }, []);

  return (
    <div className="space-y-7">
      <SettingsSection
        title="Runtime"
        description="Status for the local renderer and Electron environment."
      >
        <div className="settings-panel">
          {[
            ["Electron", versions?.electron || "Loading…"],
            ["Chrome", versions?.chrome || "Loading…"],
            ["Node", versions?.node || "Loading…"],
          ].map(([label, value]) => (
            <div className="settings-row" key={label}>
              <div className="settings-row-copy">
                <p className="settings-row-label">{label}</p>
                <p className="settings-row-description font-mono">{value}</p>
              </div>
              <span className="settings-status settings-status--ok">Connected</span>
            </div>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Local services"
        description="MCP servers and organization endpoints used by desktop agents."
      >
        <McpSettings dialogOpen />
      </SettingsSection>
    </div>
  );
}

function DesktopUpdatesSettings() {
  const [automatic, setAutomatic] = useStoredBoolean("settings-update-checks", true);
  const [download, setDownload] = useStoredBoolean("settings-update-downloads", false);
  const [versions, setVersions] = useState<{
    chrome: string;
    node: string;
    electron: string;
  } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void window.ipc.invoke("app:getVersions", null).then(setVersions);
  }, []);

  return (
    <div className="settings-panel">
      <div className="settings-row">
        <div className="settings-row-copy">
          <p className="settings-row-label">Current desktop runtime</p>
          <p className="settings-row-description">
            Electron {versions?.electron || "…"} · Stable channel
          </p>
        </div>
        <button className="settings-button" onClick={() => setChecked(true)} type="button">
          {checked ? "Up to date" : "Check now"}
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-copy">
          <p className="settings-row-label">Release channel</p>
          <p className="settings-row-description">Stable releases are recommended.</p>
        </div>
        <select className="settings-select w-32" defaultValue="stable">
          <option value="stable">Stable</option>
        </select>
      </div>
      {[
        {
          value: automatic,
          setValue: setAutomatic,
          label: "Check automatically",
          description: "Look for new desktop releases in the background.",
        },
        {
          value: download,
          setValue: setDownload,
          label: "Download automatically",
          description: "Download new releases and ask before restarting.",
        },
      ].map((option) => (
        <div className="settings-row" key={option.label}>
          <div className="settings-row-copy">
            <p className="settings-row-label">{option.label}</p>
            <p className="settings-row-description">{option.description}</p>
          </div>
          <button
            aria-checked={option.value}
            aria-label={option.label}
            className="settings-switch"
            onClick={() => option.setValue(!option.value)}
            role="switch"
            type="button"
          />
        </div>
      ))}
    </div>
  );
}

// --- Main Settings Dialog ---

function NotificationSettings() {
  const [cloudRunsOfflineNotify, setCloudRunsOfflineNotify] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.ipc.invoke("notifications:getConfig", null).then((cfg) => {
      if (cancelled) return;
      setCloudRunsOfflineNotify(cfg.cloudRunsOfflineNotify);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = useCallback(async (next: boolean) => {
    setSaving(true);
    try {
      const cfg = await window.ipc.invoke("notifications:setConfig", {
        cloudRunsOfflineNotify: next,
      });
      setCloudRunsOfflineNotify(cfg.cloudRunsOfflineNotify);
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Cloud runs"
        description="Background tasks that run in the cloud keep working while this app is closed."
      >
        <div className="flex items-start gap-3 rounded-none border bg-card px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">System notifications for missed runs</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Show a system notification when cloud runs finished while the app was closed (in
              addition to the in-app notice).
            </div>
          </div>
          <Switch
            checked={cloudRunsOfflineNotify}
            onCheckedChange={(next) => void handleToggle(next)}
            disabled={!loaded || saving}
            aria-label="System notifications for missed runs"
          />
        </div>
      </SettingsSection>
    </div>
  );
}

export function SettingsDialog({
  children,
  defaultTab = "overview",
  open: controlledOpen,
  onOpenChange,
  onStartTour,
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

  // ... (ERRORS.md E51) Keep the Models tab visible when signed in so the
  // signed-in model picker (SolomonModelSettings) stays reachable — the models
  // tab content branches to it below. Previously it was filtered out, leaving
  // signed-in users with no path to the picker.
  const visibleTabs = tabs;

  const activeTabConfig = visibleTabs.find((t) => t.id === activeTab) ?? visibleTabs[0];

  const ActiveIcon = activeTabConfig.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent
        className="rowboat-settings settings-workspace h-[85vh] max-h-[85vh] w-[85vw]! max-w-[85vw]! gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage account, connections, models, transcription, tags, notifications, appearance,
          security, tools, memory, and support settings.
        </DialogDescription>
        <div className="flex h-full overflow-hidden">
          <div className="settings-rail flex w-60 shrink-0 flex-col border-r">
            <nav className="settings-rail-scroll flex-1 overflow-y-auto px-2 pb-3 pt-2">
              <button className="settings-back" onClick={() => setOpen(false)} type="button">
                <ArrowLeft className="size-3.5" />
                <span>Back to app</span>
              </button>
              <button
                className="settings-identity"
                onClick={() => setActiveTab("overview")}
                type="button"
              >
                <span>{PRODUCT_NAME}</span>
                <ChevronRight className="size-3.5 rotate-90" />
              </button>
              <button
                className="settings-nav-item mt-1"
                data-active={activeTab === "overview"}
                onClick={() => setActiveTab("overview")}
                type="button"
              >
                <Settings />
                <span>Settings</span>
              </button>
              {GROUP_ORDER.map((group) => (
                <div key={group}>
                  <div className="settings-rail-heading">{GROUP_LABELS[group]}</div>
                  <div className="space-y-0.5">
                    {visibleTabs
                      .filter((tab) => tab.group === group)
                      .map((tab) => (
                        <button
                          className="settings-nav-item"
                          data-active={activeTab === tab.id}
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          type="button"
                        >
                          <tab.icon />
                          <span className="truncate">{tab.label}</span>
                          {tab.beta ? <span className="settings-beta">Beta</span> : null}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>

          <div className="settings-stage flex min-w-0 flex-1 flex-col">
            <div className="settings-stage-header">
              <div className="flex min-w-0 items-center gap-2">
                <ActiveIcon className="size-3.5 shrink-0 opacity-60" />
                <span className="settings-stage-header-title">{activeTabConfig.label}</span>
              </div>
              <span className="settings-stage-header-brand">{PRODUCT_NAME}</span>
            </div>

            <div className="settings-page-scroll min-h-0 flex-1">
              {activeTab === "overview" ? (
                <SettingsOverview onNavigate={setActiveTab} />
              ) : (
                <SettingsPage
                  description={
                    activeTab === "models" && solomonConnected
                      ? "Select the default models used across relationship workflows."
                      : activeTabConfig.description
                  }
                  title={activeTabConfig.label}
                >
                  {activeTab === "preferences" ? (
                    <div className="space-y-7">
                      <SettingsSection
                        title="Model"
                        description="Control reasoning visibility, context, privacy, and memory."
                      >
                        <DesktopPreferenceToggles />
                      </SettingsSection>
                      <NotificationSettings />
                    </div>
                  ) : activeTab === "notifications" ? (
                    <NotificationSettings />
                  ) : activeTab === "privacy" ? (
                    <PrivacySettings dialogOpen={open} />
                  ) : activeTab === "permissions" ? (
                    <SecuritySettings dialogOpen={open} />
                  ) : activeTab === "security" ? (
                    <SecuritySettings dialogOpen={open} />
                  ) : activeTab === "extensions" ? (
                    <div className="space-y-7">
                      <SettingsSection title="Primary accounts">
                        <ConnectedAccountsSettings dialogOpen={open} />
                      </SettingsSection>
                      <SettingsSection
                        title="Available extensions"
                        description="Connect the services your relationship model can observe."
                      >
                        <ToolsLibrarySettings
                          dialogOpen={open}
                          rowboatConnected={solomonConnected}
                        />
                      </SettingsSection>
                      <SettingsSection
                        title="Custom MCP servers"
                        description="Add local or remote agent tools."
                      >
                        <McpSettings dialogOpen={open} />
                      </SettingsSection>
                    </div>
                  ) : activeTab === "connections" ? (
                    <SettingsSection
                      title="Sources and accounts"
                      description="Connected sources, anything that needs attention, and the available catalog."
                    >
                      <ConnectedAccountsSettings dialogOpen={open} />
                    </SettingsSection>
                  ) : activeTab === "transcription" ? (
                    <TranscriptionSettings dialogOpen={open} />
                  ) : activeTab === "note-tagging" ? (
                    <NoteTaggingSettings dialogOpen={open} />
                  ) : activeTab === "advanced" ? (
                    <div className="space-y-9">
                      <CodeModeSettings dialogOpen={open} />
                      <Separator />
                      <TranscriptionSettings dialogOpen={open} />
                      <Separator />
                      <NoteTaggingSettings dialogOpen={open} />
                    </div>
                  ) : activeTab === "models" ? (
                    solomonConnected ? (
                      <SolomonModelSettings dialogOpen={open} />
                    ) : (
                      <ModelSettings dialogOpen={open} />
                    )
                  ) : activeTab === "code-mode" ? (
                    <CodeModeSettings dialogOpen={open} />
                  ) : activeTab === "customization" ? (
                    <CustomizationSettings />
                  ) : activeTab === "appearance" ? (
                    <AppearanceSettings />
                  ) : activeTab === "mcp" ? (
                    <McpSettings dialogOpen={open} />
                  ) : activeTab === "environment" ? (
                    <DesktopEnvironmentSettings />
                  ) : activeTab === "updates" ? (
                    <DesktopUpdatesSettings />
                  ) : activeTab === "memory" ? (
                    <MemorySettings dialogOpen={open} />
                  ) : activeTab === "recovery" ? (
                    <RecoverySettings dialogOpen={open} />
                  ) : activeTab === "account" ? (
                    <AccountSettings dialogOpen={open} />
                  ) : activeTab === "connect" ? (
                    <div className="space-y-7">
                      <div className="settings-inline-notice">
                        Cloud connections remain shared through your signed-in Oppulence account.
                      </div>
                      <SettingsSection title="Connected services">
                        <ConnectedAccountsSettings dialogOpen={open} />
                      </SettingsSection>
                      <SettingsSection title="From your organization">
                        <ToolsLibrarySettings
                          dialogOpen={open}
                          rowboatConnected={solomonConnected}
                        />
                      </SettingsSection>
                    </div>
                  ) : activeTab === "help" ? (
                    <HelpSettings
                      onStartTour={() => {
                        setOpen(false);
                        onStartTour?.();
                      }}
                    />
                  ) : null}
                </SettingsPage>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
