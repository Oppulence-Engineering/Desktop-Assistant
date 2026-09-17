"use client";

import * as React from "react";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  Clipboard,
  MagnifyingGlass,
  Monitor,
  Moon,
  Plugs,
  ShieldCheck,
  Sun,
  type Icon as PhosphorIcon,
} from "@/lib/icons";

import {
  SETTINGS_SECTIONS,
  useThemePreference,
  type SettingsSection,
  type ThemePreference,
} from "@/components/app-shell";
import { DeleteAccountRow } from "@/components/features/account/delete-account-row";
import { ConnectorSettings } from "@/components/features/connectors/connector-settings";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { CardDescription, CardTitle } from "@oppulence/ui/components/card";
import { ItemMedia } from "@oppulence/ui/components/item";
import { Label } from "@oppulence/ui/components/label";
import { Skeleton } from "@oppulence/ui/components/skeleton";
import { Input } from "@oppulence/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { Switch } from "@oppulence/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@oppulence/ui/components/toggle-group";
import { dashboardFetch } from "@/lib/auth/client";
import { ListConnectors200Response } from "@/lib/api/generated/zod/connectors/connectors";
import { GetGoogleConnectionStatus200Response } from "@/lib/api/generated/zod/google-oauth/google-oauth";
import { GetRelationshipSourceInventory200Response } from "@/lib/api/generated/zod/relationship-intelligence/relationship-intelligence";
import { ListSlackWorkspaces200Response } from "@/lib/api/generated/zod/slack-oauth/slack-oauth";
import type { Connector } from "@/lib/api/generated/client/model/connector";
import type { GoogleConnectionAccount } from "@/lib/api/generated/client/model/googleConnectionAccount";
import type { RelationshipSourceInventoryItem } from "@/lib/api/generated/client/model/relationshipSourceInventoryItem";
import type { SlackWorkspace } from "@/lib/api/generated/client/model/slackWorkspace";
import { getPref, setPref } from "@/lib/console-prefs";
import { cn } from "@/lib/utils";

type SessionShape = {
  user: {
    id?: string;
    workosUserId?: string;
    email?: string;
    organizationId?: string;
    role?: string;
    permissions: string[];
  };
  billing?: {
    plan?: string | null;
    status?: string | null;
    trialExpiresAt?: string | null;
    usage?: unknown;
  };
};

/* ------------------------------ layout pieces ------------------------------ */

function SettingsRow({
  title,
  description,
  danger,
  footer,
  children,
}: {
  title: string;
  description?: string;
  danger?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section-block">
      <div className="settings-section-heading">
        <div>
          <h2 className={cn("settings-section-title", danger && "!text-[var(--settings-danger)]")}>
            {title}
          </h2>
          {description ? <p className="settings-section-description">{description}</p> : null}
        </div>
      </div>
      <div
        className={cn(
          "settings-panel flex flex-col",
          danger && "!border-destructive/30 bg-destructive/5",
        )}
      >
        {children}
        {footer ? (
          <div className="flex items-center justify-end border-t border-[var(--settings-line)] py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ValueRow({
  label,
  value,
  copy,
}: {
  label: string;
  value?: string | null;
  copy?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="group/row flex min-h-[34px] items-center justify-between gap-4 rounded-none px-4 py-1 transition-colors hover:bg-background-100 dark:hover:bg-background-200">
      <Label className="text-xs font-normal capitalize text-primary/60">{label}</Label>
      <div className="flex min-w-0 items-center gap-1.5">
        <Badge
          className={cn(
            "truncate font-mono font-normal",
            value ? "text-primary" : "text-primary/40",
          )}
          variant="secondary"
        >
          {value || "—"}
        </Badge>
        {copy && value ? (
          <Button
            aria-label={`Copy ${label}`}
            className="size-7 text-primary/50 opacity-0 transition-opacity hover:text-primary group-hover/row:opacity-100"
            onClick={handleCopy}
            size="icon"
            type="button"
            variant="ghost"
          >
            {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyCardState({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

/**
 * Card footer with a dirty-gated save button and a transient "Saved" hint —
 * the explicit-save pattern used across the settings cards.
 */
function SaveFooter({
  dirty,
  saving,
  saved,
  label,
  onSave,
}: {
  dirty: boolean;
  saving?: boolean;
  saved: boolean;
  label: string;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-[var(--settings-line)] py-3">
      {saved ? (
        <Badge className="font-mono text-xs text-oppulence-orange" variant="outline">
          saved
        </Badge>
      ) : null}
      <Button disabled={!dirty || saving} onClick={onSave} size="sm">
        {saving ? "Saving…" : label}
      </Button>
    </div>
  );
}

function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = React.useState(false);
  const flash = React.useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }, []);
  return [saved, flash];
}

function SettingsStatus({ children }: { children: React.ReactNode }) {
  return (
    <Badge
      className="settings-status settings-status--ok rounded-none border-0 bg-transparent px-0 font-normal shadow-none hover:bg-transparent"
      variant="outline"
    >
      {children}
    </Badge>
  );
}

function ThemePreviewSkeleton({ dark }: { dark: boolean }) {
  const line = dark ? "bg-zinc-400/35" : "bg-zinc-400/35";
  const accent = dark ? "bg-zinc-400/60" : "bg-zinc-400/60";
  return (
    <div
      className={cn(
        "flex h-20 overflow-hidden rounded-none border",
        dark ? "border-zinc-700 bg-zinc-900" : "bg-white",
      )}
    >
      <div
        className={cn(
          "w-1/3 border-r p-2",
          dark ? "border-zinc-700 bg-zinc-800" : "border-zinc-200 bg-zinc-100",
        )}
      >
        <Skeleton className={cn("mb-2 h-1.5 w-2/3 rounded-none", accent)} />
        <Skeleton className={cn("mb-1.5 h-1 w-full rounded-none", line)} />
        <Skeleton className={cn("h-1 w-4/5 rounded-none", line)} />
      </div>
      <div className="flex-1 p-2">
        <Skeleton className={cn("mb-2 h-1.5 w-1/2 rounded-none", accent)} />
        <Skeleton className={cn("mb-1.5 h-1 w-full rounded-none", line)} />
        <Skeleton className={cn("h-1 w-4/5 rounded-none", line)} />
      </div>
    </div>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <Label className="block text-sm text-primary">{children}</Label>
      {hint ? (
        <CardDescription className="block text-xs text-muted-foreground">{hint}</CardDescription>
      ) : null}
    </div>
  );
}

/* -------------------------------- sections --------------------------------- */

function ProfileCard() {
  const [name, setName] = React.useState("");
  const [initial, setInitial] = React.useState("");
  const [saved, flash] = useSavedFlash();

  React.useEffect(() => {
    const current = getPref("display-name") || "";
    setName(current);
    setInitial(current);
  }, []);

  const dirty = name !== initial;

  const save = () => {
    setPref("display-name", name.trim());
    setInitial(name.trim());
    setName(name.trim());
    flash();
  };

  return (
    <SettingsRow
      description="How you appear in this console on this device."
      footer={<SaveFooter dirty={dirty} label="Save profile" onSave={save} saved={saved} />}
      title="Profile"
    >
      <div className="space-y-6 py-2">
        <div>
          <FieldLabel hint="Shown in the sidebar instead of your email.">Display name</FieldLabel>
          <Input
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
            value={name}
          />
        </div>
      </div>
    </SettingsRow>
  );
}

function DefaultsCard() {
  const { items, state } = useJsonList("/api/rowboat/v1/agents", (data) => {
    const record = (data ?? {}) as Record<string, unknown>;
    return Array.isArray(record.agents) ? record.agents : [];
  });
  // The chat session API is keyed by slug, so prefer it over the display name.
  const agentNames = items
    .map((item) => {
      if (typeof item === "string") return item;
      const record = (item ?? {}) as Record<string, unknown>;
      return typeof record.slug === "string" ? record.slug : nameOf(item);
    })
    .filter(Boolean);

  const [agent, setAgent] = React.useState("");
  const [initial, setInitial] = React.useState("");
  const [saved, flash] = useSavedFlash();

  React.useEffect(() => {
    const current = getPref("default-agent") || "";
    setAgent(current);
    setInitial(current);
  }, []);

  const dirty = agent !== initial;

  const save = () => {
    setPref("default-agent", agent);
    setInitial(agent);
    flash();
  };

  return (
    <SettingsRow
      description="What new chats start with. Applies the next time you open the console."
      footer={<SaveFooter dirty={dirty} label="Save defaults" onSave={save} saved={saved} />}
      title="Chat Defaults"
    >
      <div className="space-y-6 px-4 py-6">
        <div>
          <FieldLabel hint="The agent preselected for new conversations.">Default agent</FieldLabel>
          <Select onValueChange={setAgent} value={agent || undefined}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue
                placeholder={state === "loading" ? "Loading agents…" : "Choose an agent"}
              />
            </SelectTrigger>
            <SelectContent className="app-shell rounded-[2px]">
              {agentNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </SettingsRow>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useThemePreference();

  const options: {
    value: ThemePreference;
    label: string;
    description: string;
    icon: PhosphorIcon;
  }[] = [
    { value: "light", label: "Light", description: "Always use the light theme.", icon: Sun },
    { value: "dark", label: "Dark", description: "Always use the dark theme.", icon: Moon },
    {
      value: "system",
      label: "System",
      description: "Follow your operating system preference.",
      icon: Monitor,
    },
  ];

  return (
    <>
      <PageIntro
        description="Choose how Oppulence looks in this browser and how it follows your system."
        title="Appearance"
      />
      <SettingsRow
        description="How the console looks on this device. Applies immediately."
        title="Theme"
      >
        <ToggleGroup
          className="settings-choice-grid p-3"
          onValueChange={(value) => value && setTheme(value as ThemePreference)}
          type="single"
          value={theme}
        >
          {options.map((option) => (
            <ToggleGroupItem
              aria-label={option.label}
              className="settings-choice h-auto flex-col data-[state=on]:shadow-none"
              data-selected={theme === option.value}
              key={option.value}
              value={option.value}
            >
              <ThemePreviewSkeleton dark={option.value === "dark"} />
              <div className="flex w-full items-center justify-between">
                <Label className="settings-choice-label font-normal">{option.label}</Label>
                {theme === option.value ? (
                  <Check className="size-3.5 text-[var(--settings-accent)]" />
                ) : null}
              </div>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsRow>
      <SettingsRow description="Language used throughout the product." title="Language">
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Interface language</p>
            <p className="settings-row-description">English is currently available.</p>
          </div>
          <Select defaultValue="en" disabled>
            <SelectTrigger aria-label="Interface language" className="settings-select w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsRow>
    </>
  );
}

function useJsonList(path: string, pick: (data: unknown) => unknown[]) {
  const [items, setItems] = React.useState<unknown[]>([]);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await dashboardFetch(path);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setItems(pick(data));
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return { items, state };
}

function nameOf(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    for (const key of ["id", "name", "slug", "model"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return JSON.stringify(item);
}

function PlanSection({ session }: { session: SessionShape }) {
  const billing = session.billing;
  const usage =
    billing?.usage && typeof billing.usage === "object" && !Array.isArray(billing.usage)
      ? Object.entries(billing.usage as Record<string, unknown>).filter(
          ([, value]) => typeof value === "string" || typeof value === "number",
        )
      : [];

  return (
    <>
      <SettingsRow description="The plan this workspace is currently on." title="Current Plan">
        <div className="flex items-center justify-between gap-6 p-4">
          <div>
            <p className="text-lg font-medium capitalize text-primary">{billing?.plan || "Free"}</p>
            {billing?.trialExpiresAt ? (
              <p className="text-xs font-medium text-oppulence-orange">
                Trial ends {new Date(billing.trialExpiresAt).toLocaleDateString()}
              </p>
            ) : null}
          </div>
          {billing?.status ? (
            <Badge className="rounded-[2px] capitalize" variant="outline">
              {billing.status}
            </Badge>
          ) : null}
        </div>
      </SettingsRow>
      <SettingsRow description="Metered activity for the current billing period." title="Usage">
        {usage.length === 0 ? (
          <EmptyCardState>No usage recorded yet.</EmptyCardState>
        ) : (
          <div className="flex flex-col gap-0.5 py-2">
            {usage.map(([key, value]) => (
              <ValueRow key={key} label={key} value={String(value)} />
            ))}
          </div>
        )}
      </SettingsRow>
    </>
  );
}

function useStoredBoolean(key: string, initial: boolean) {
  const [value, setValue] = React.useState(() => {
    if (typeof window === "undefined") return initial;
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "true";
  });

  const update = React.useCallback(
    (next: boolean) => {
      setValue(next);
      localStorage.setItem(key, String(next));
    },
    [key],
  );

  return [value, update] as const;
}

function PreferenceToggle({
  storageKey,
  label,
  description,
  initial = false,
}: {
  storageKey: string;
  label: string;
  description: string;
  initial?: boolean;
}) {
  const [checked, setChecked] = useStoredBoolean(storageKey, initial);

  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <p className="settings-row-label">{label}</p>
        <p className="settings-row-description">{description}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        className="settings-switch shrink-0"
        onCheckedChange={setChecked}
      />
    </div>
  );
}

const NOTIFICATION_LEVELS = [
  { value: "off", label: "Off" },
  { value: "attention", label: "Needs attention" },
  { value: "all", label: "All relationship changes" },
] as const;

function NotificationLevelSelect() {
  const [level, setLevel] = React.useState(() => getPref("notification-level") || "off");

  return (
    <Select
      onValueChange={(value) => {
        setLevel(value);
        setPref("notification-level", value);
      }}
      value={level}
    >
      <SelectTrigger aria-label="Notification level" className="settings-select w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NOTIFICATION_LEVELS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <header className="settings-page-intro">
      <h1 className="settings-page-title">{title}</h1>
      {description ? <p className="settings-page-description">{description}</p> : null}
    </header>
  );
}

const OVERVIEW_KEYS: SettingsSection[] = [
  "preferences",
  "connections",
  "appearance",
  "account",
  "help",
];

function OverviewSection({ onNavigate }: { onNavigate: (section: SettingsSection) => void }) {
  return (
    <>
      <PageIntro
        description="Workspace, connections, and how Oppulence behaves."
        title="Settings"
      />
      <nav aria-label="Settings sections" className="settings-link-list">
        {OVERVIEW_KEYS.map((key) => {
          const section = SETTINGS_SECTIONS.find((item) => item.key === key);
          if (!section) return null;
          return (
            <Button
              className="settings-link-row h-auto justify-start"
              key={section.key}
              onClick={() => onNavigate(section.key)}
              type="button"
              variant="ghost"
            >
              <ItemMedia className="settings-link-row-icon" variant="icon">
                <section.icon />
              </ItemMedia>
              <div className="settings-link-row-copy min-w-0 flex-1">
                <CardTitle className="settings-link-row-title text-sm">{section.label}</CardTitle>
                <CardDescription className="settings-link-row-description">
                  {section.description}
                </CardDescription>
              </div>
              <ArrowRight className="ml-2 size-3.5 shrink-0 text-primary/25" />
            </Button>
          );
        })}
      </nav>
    </>
  );
}

function PreferencesSection() {
  return (
    <>
      <PageIntro
        description="Choose the defaults Oppulence uses while reviewing and maintaining relationships."
        title="Preferences"
      />
      <DefaultsCard />
      <SettingsRow
        description="Control how much of the model's work is visible and when context is compacted."
        title="Model"
      >
        <PreferenceToggle
          description="Show the reasoning trace when a recommendation is generated."
          initial
          label="Show model reasoning"
          storageKey="settings-show-model-reasoning"
        />
        <PreferenceToggle
          description="Compress older evidence automatically as the working context grows."
          initial
          label="Auto context compaction"
          storageKey="settings-auto-context-compaction"
        />
      </SettingsRow>
      <SettingsRow
        description="Choose when the console may call your attention back to a relationship."
        title="Desktop notifications"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Notify me</p>
            <p className="settings-row-description">
              Browser notifications stay off until you choose a level.
            </p>
          </div>
          <NotificationLevelSelect />
        </div>
      </SettingsRow>
      <SettingsRow
        description="These controls stay local to this browser."
        title="Privacy & memory"
      >
        <PreferenceToggle
          description="Share anonymous product telemetry. Relationship content is never included."
          initial
          label="Share anonymous usage data"
          storageKey="settings-share-usage"
        />
        <PreferenceToggle
          description="Build a private semantic memory from approved relationship evidence."
          label="Memory Bank (preview)"
          storageKey="settings-memory-bank"
        />
      </SettingsRow>
    </>
  );
}

function NotificationsSection() {
  return (
    <>
      <PageIntro
        description="Choose when the console may call your attention back to a relationship."
        title="Notifications"
      />
      <SettingsRow
        description="Browser notifications stay off until you choose a delivery level."
        title="Delivery"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Notify me</p>
            <p className="settings-row-description">
              Choose which relationship changes are important enough to surface.
            </p>
          </div>
          <NotificationLevelSelect />
        </div>
      </SettingsRow>
    </>
  );
}

function SecuritySection({ session }: { session: SessionShape }) {
  return (
    <>
      <PageIntro
        description="Review the identity, organization, and evidence permissions active in this session."
        title="Security"
      />
      <SettingsRow
        description="Workspace access is controlled by the signed-in Oppulence organization."
        title="Session access"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Organization</p>
            <p className="settings-row-description">
              {session.user.organizationId || "No organization is attached to this session."}
            </p>
          </div>
          <SettingsStatus>Authorized</SettingsStatus>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Effective permissions</p>
            <p className="settings-row-description">
              {session.user.permissions.length > 0
                ? session.user.permissions.join(", ")
                : "Standard relationship access"}
            </p>
          </div>
          <ShieldCheck className="size-4 text-[var(--settings-success)]" />
        </div>
      </SettingsRow>
    </>
  );
}

function HelpSection() {
  const items = [
    {
      title: "Send feedback",
      description: "Tell us what is missing or where relationship intelligence should go next.",
      icon: Bell,
      href: "mailto:hello@oppulence.io?subject=Oppulence%20feedback",
    },
    {
      title: "Read the documentation",
      description: "Review the relationship model, product guides, and API reference.",
      icon: BookOpen,
      href: "/api/reference",
    },
  ];

  return (
    <>
      <PageIntro
        description="Get help, report a problem, or review the product documentation."
        title="Help"
      />
      <div className="settings-card-grid">
        {items.map((item) => (
          <Button
            className="settings-card h-auto"
            key={item.title}
            onClick={() => window.open(item.href, "_blank")}
            type="button"
            variant="ghost"
          >
            <ItemMedia className="settings-card-icon" variant="icon">
              <item.icon />
            </ItemMedia>
            <div className="settings-card-copy">
              <CardTitle className="settings-card-title text-sm">{item.title}</CardTitle>
              <CardDescription className="settings-card-description">
                {item.description}
              </CardDescription>
            </div>
            <ArrowRight className="ml-auto size-3.5 shrink-0 text-primary/30" />
          </Button>
        ))}
      </div>
    </>
  );
}

function PermissionsSection({ session }: { session: SessionShape }) {
  return (
    <>
      <PageIntro
        description="Review who you are, what this session can reach, and which permissions are active."
        title="Permissions"
      />
      <SettingsRow
        description="The signed-in organization controls access to shared relationships and evidence."
        title="Authorized workspace"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Current organization</p>
            <p className="settings-row-description">
              {session.user.organizationId || "No organization is attached to this session."}
            </p>
          </div>
          <SettingsStatus>Authorized</SettingsStatus>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Workspace role</p>
            <p className="settings-row-description">
              {session.user.role || "Member"} ·{" "}
              {session.user.permissions.length
                ? session.user.permissions.join(", ")
                : "Standard relationship access"}
            </p>
          </div>
          <ShieldCheck className="size-4 text-[var(--settings-success)]" />
        </div>
      </SettingsRow>
      <SettingsRow
        description="Oppulence only uses evidence returned by authorized services."
        title="Evidence access"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Connected services</p>
            <p className="settings-row-description">
              Manage service-level access from Extensions. Removing a connection stops new evidence
              from entering the relationship model.
            </p>
          </div>
          <Plugs className="size-4 text-primary/40" />
        </div>
      </SettingsRow>
    </>
  );
}

function CustomizationSection() {
  const [appName, setAppName] = React.useState("Oppulence");
  const [savedName, setSavedName] = React.useState("Oppulence");
  const [sidebar, setSidebar] = useStoredBoolean("settings-display-sidebar", true);
  const [statusBar, setStatusBar] = useStoredBoolean("settings-display-status-bar", true);
  const [docs, setDocs] = useStoredBoolean("settings-display-docs", true);
  const [feedback, setFeedback] = useStoredBoolean("settings-display-feedback", true);

  React.useEffect(() => {
    const stored = localStorage.getItem("settings-app-name") || "Oppulence";
    setAppName(stored);
    setSavedName(stored);
  }, []);

  return (
    <>
      <PageIntro
        description="Tune the console's identity and the navigation elements your team sees."
        title="Customization"
      />
      <SettingsRow
        description="Set the local workspace label shown in this browser."
        title="Branding"
      >
        <div className="space-y-3 p-4">
          <label className="block text-xs font-medium text-primary" htmlFor="settings-app-name">
            App name
          </label>
          <div className="flex gap-2">
            <Input
              className="settings-control min-w-0 flex-1"
              id="settings-app-name"
              onChange={(event) => setAppName(event.target.value)}
              value={appName}
            />
            <Button
              className="settings-button settings-button--primary"
              disabled={appName.trim() === savedName}
              onClick={() => {
                const next = appName.trim() || "Oppulence";
                localStorage.setItem("settings-app-name", next);
                setAppName(next);
                setSavedName(next);
              }}
              type="button"
            >
              Save
            </Button>
          </div>
        </div>
      </SettingsRow>
    </>
  );
}

function AccountSection({ session }: { session: SessionShape }) {
  return (
    <>
      <PageIntro
        description="Manage your identity, organization, plan, and current browser session."
        title="Account"
      />
      <ProfileCard />
      <SettingsRow
        description="Your identity for this workspace. IDs are safe to share with support."
        title="Oppulence Cloud"
      >
        <div className="flex flex-col gap-0.5 py-2">
          <ValueRow label="Email" value={session.user.email} />
          <ValueRow copy label="User ID" value={session.user.workosUserId || session.user.id} />
          <ValueRow copy label="Organization" value={session.user.organizationId} />
          <ValueRow label="Role" value={session.user.role} />
        </div>
      </SettingsRow>
      <PlanSection session={session} />
      <SettingsRow danger title="Session and account">
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Sign out</p>
            <p className="settings-row-description">
              End this browser session. You can sign back in at any time.
            </p>
          </div>
          <Button
            onClick={() => window.location.assign("/api/auth/logout")}
            size="sm"
            variant="destructive"
          >
            Sign out
          </Button>
        </div>
        <DeleteAccountRow />
      </SettingsRow>
    </>
  );
}

/* ------------------------------- main view --------------------------------- */

export function SettingsView({
  section,
  session,
  onNavigate,
}: {
  section: SettingsSection;
  session: SessionShape;
  onNavigate: (section: SettingsSection) => void;
}) {
  const current = SETTINGS_SECTIONS.find((item) => item.key === section) ?? SETTINGS_SECTIONS[0];

  return (
    <div className="settings-page-scroll flex-1">
      <div className={cn("settings-page", section === "overview" && "settings-page--wide")}>
        {section === "overview" ? <OverviewSection onNavigate={onNavigate} /> : null}
        {section === "preferences" ? <PreferencesSection /> : null}
        {section === "notifications" ? <NotificationsSection /> : null}
        {section === "permissions" ? <PermissionsSection session={session} /> : null}
        {section === "security" ? <SecuritySection session={session} /> : null}
        {section === "connections" ? (
          <>
            <PageIntro description={current.description} title={current.label} />
            <ConnectorSettings />
          </>
        ) : null}
        {section === "advanced" ? (
          <>
            <PageIntro description={current.description} title={current.label} />
            <SettingsRow
              description="Advanced endpoints used by the current organization."
              title="Server configuration"
            >
              <div className="settings-row">
                <div className="settings-row-copy">
                  <p className="settings-row-label">Organization server</p>
                  <p className="settings-row-description font-mono">
                    {typeof window === "undefined" ? "" : window.location.origin}
                  </p>
                </div>
                <SettingsStatus>Default</SettingsStatus>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <p className="settings-row-label">Relationship API</p>
                  <p className="settings-row-description font-mono">
                    /api/rowboat/v1/relationships
                  </p>
                </div>
                <SettingsStatus>Available</SettingsStatus>
              </div>
            </SettingsRow>
            <SettingsRow
              description="The web console uses cloud execution while the desktop adds local agent diagnostics."
              title="Agent access diagnostics"
            >
              <div className="settings-row">
                <div className="settings-row-copy">
                  <p className="settings-row-label">Cloud relationship engine</p>
                  <p className="settings-row-description">
                    Evidence queries and governed actions use the signed-in organization.
                  </p>
                </div>
                <Button
                  className="settings-button"
                  onClick={() => window.location.reload()}
                  type="button"
                  variant="outline"
                >
                  Refresh
                </Button>
              </div>
            </SettingsRow>
          </>
        ) : null}
        {section === "customization" ? <CustomizationSection /> : null}
        {section === "appearance" ? <AppearanceSection /> : null}
        {section === "account" ? <AccountSection session={session} /> : null}
        {section === "connect" ? (
          <>
            <PageIntro
              description="Use organization-approved connections across every relationship workflow."
              title="Oppulence Connect"
            />
            <div className="settings-inline-notice">
              Connected to {session.user.organizationId || "your Oppulence organization"}.
            </div>
            <ConnectorSettings />
          </>
        ) : null}
        {section === "help" ? <HelpSection /> : null}
      </div>
    </div>
  );
}
