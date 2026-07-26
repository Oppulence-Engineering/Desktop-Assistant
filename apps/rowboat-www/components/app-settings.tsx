"use client";

import * as React from "react";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  Clipboard,
  Cloud,
  Monitor,
  Moon,
  Plugs,
  ShieldCheck,
  Sun,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import {
  SETTINGS_SECTIONS,
  useThemePreference,
  type SettingsSection,
  type ThemePreference,
} from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dashboardFetch } from "@/lib/auth/client";
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
          <div className="flex items-center justify-end border-t border-[var(--settings-line)] px-4 py-3">
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
    <div className="group/row flex min-h-[34px] items-center justify-between gap-4 rounded-sm px-4 py-1 transition-colors hover:bg-background-100 dark:hover:bg-background-200">
      <span className="text-xs capitalize text-primary/60">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "truncate text-right font-mono text-xs",
            value ? "text-primary" : "text-primary/40",
          )}
        >
          {value || "—"}
        </span>
        {copy && value ? (
          <button
            aria-label={`Copy ${label}`}
            className="text-primary/50 opacity-0 transition-opacity hover:text-primary group-hover/row:opacity-100"
            onClick={handleCopy}
            type="button"
          >
            {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
          </button>
        ) : null}
      </span>
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
    <div className="flex items-center justify-end gap-3 border-t bg-background-100 p-4 dark:bg-background-200">
      {saved ? <span className="font-mono text-xs text-oppulence-orange">saved</span> : null}
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

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <span className="block text-sm font-medium text-primary">{children}</span>
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
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
      <div className="space-y-6 px-4 py-6">
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
        <div className="settings-choice-grid p-3">
          {options.map((option) => (
            <button
              className="settings-choice"
              data-selected={theme === option.value}
              key={option.value}
              onClick={() => setTheme(option.value)}
              type="button"
            >
              <span
                className={cn(
                  "flex h-20 overflow-hidden rounded-md border",
                  option.value === "dark" ? "border-zinc-700 bg-zinc-900" : "bg-white",
                )}
              >
                <span
                  className={cn(
                    "w-1/3 border-r p-2",
                    option.value === "dark"
                      ? "border-zinc-700 bg-zinc-800"
                      : "border-zinc-200 bg-zinc-100",
                  )}
                >
                  <span className="mb-2 block h-1.5 w-2/3 rounded-full bg-zinc-400/60" />
                  <span className="mb-1.5 block h-1 w-full rounded-full bg-zinc-400/35" />
                  <span className="block h-1 w-4/5 rounded-full bg-zinc-400/35" />
                </span>
                <span className="flex-1 p-2">
                  <span className="mb-2 block h-1.5 w-1/2 rounded-full bg-zinc-400/60" />
                  <span className="mb-1.5 block h-1 w-full rounded-full bg-zinc-400/35" />
                  <span className="block h-1 w-4/5 rounded-full bg-zinc-400/35" />
                </span>
              </span>
              <span className="flex items-center justify-between">
                <span className="settings-choice-label">{option.label}</span>
                {theme === option.value ? (
                  <Check className="size-3.5 text-[var(--settings-accent)]" />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow description="Language used throughout the product." title="Language">
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Interface language</p>
            <p className="settings-row-description">English is currently available.</p>
          </div>
          <select className="settings-select w-40" defaultValue="en">
            <option value="en">English</option>
          </select>
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

function ModelsSection() {
  const { items, state } = useJsonList("/api/rowboat/v1/llm/models", (data) => {
    const record = (data ?? {}) as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.models)) return record.models;
    return Array.isArray(data) ? (data as unknown[]) : [];
  });

  return (
    <SettingsRow
      description="The catalog served by the Oppulence LLM gateway. It is managed server-side; pick what new chats use under General → Chat Defaults."
      title="Models"
    >
      {state === "loading" ? (
        <EmptyCardState>Loading models…</EmptyCardState>
      ) : state === "error" ? (
        <EmptyCardState>Could not reach the model gateway.</EmptyCardState>
      ) : items.length === 0 ? (
        <EmptyCardState>No models are configured for this workspace.</EmptyCardState>
      ) : (
        <div className="flex flex-col divide-y divide-primary/10">
          {items.map((item) => {
            const name = nameOf(item);
            const provider = name.includes("/") ? name.split("/")[0] : null;
            return (
              <div className="flex items-center justify-between gap-4 px-4 py-2.5" key={name}>
                <span className="truncate font-mono text-sm text-primary">{name}</span>
                {provider ? (
                  <Badge className="shrink-0 rounded-[2px] capitalize" variant="outline">
                    {provider}
                  </Badge>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </SettingsRow>
  );
}

type ConnectorEntry = {
  name: string;
  description?: string;
  authType?: "oauth" | "api_key";
  connected: boolean;
  connectedAt?: string | null;
};

function ConnectorRow({
  connector,
  onChanged,
}: {
  connector: ConnectorEntry;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [keyOpen, setKeyOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error)?.message || "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const res = await dashboardFetch(
        `/api/rowboat/v1/connections/${encodeURIComponent(connector.name)}/start`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`Connect failed (${res.status})`);
      const data = await res.json();
      if (typeof data?.authorize_url === "string") {
        window.open(data.authorize_url, "_blank", "noopener");
      }
    });

  const saveKey = () =>
    run(async () => {
      const res = await dashboardFetch(
        `/api/rowboat/v1/connections/${encodeURIComponent(connector.name)}/api-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        },
      );
      if (!res.ok) throw new Error(`Saving key failed (${res.status})`);
      setApiKey("");
      setKeyOpen(false);
    });

  const disconnect = () =>
    run(async () => {
      const res = await dashboardFetch(
        `/api/rowboat/v1/connections/${encodeURIComponent(connector.name)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
      setConfirming(false);
    });

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium capitalize text-primary">
              {connector.name}
            </span>
            {connector.connected ? (
              <Badge className="shrink-0 rounded-[2px] border-oppulence-green/40 text-oppulence-green">
                Connected
              </Badge>
            ) : (
              <Badge className="shrink-0 rounded-[2px] text-primary/50" variant="outline">
                Not connected
              </Badge>
            )}
          </span>
          {connector.description ? (
            <span className="block truncate text-xs text-muted-foreground">
              {connector.description}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connector.connected ? (
            confirming ? (
              <>
                <Button disabled={busy} onClick={disconnect} size="sm" variant="destructive">
                  {busy ? "Disconnecting…" : "Confirm"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirming(true)} size="sm" variant="outline">
                Disconnect
              </Button>
            )
          ) : connector.authType === "api_key" ? (
            <Button
              disabled={busy}
              onClick={() => setKeyOpen((open) => !open)}
              size="sm"
              variant="outline"
            >
              {keyOpen ? "Cancel" : "Add API key"}
            </Button>
          ) : (
            <Button disabled={busy} onClick={connect} size="sm">
              {busy ? "Opening…" : "Connect"}
            </Button>
          )}
        </div>
      </div>
      {keyOpen && !connector.connected ? (
        <div className="flex items-center gap-2">
          <Input
            className="max-w-sm"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Vendor API key"
            type="password"
            value={apiKey}
          />
          <Button disabled={!apiKey.trim() || busy} onClick={saveKey} size="sm">
            {busy ? "Saving…" : "Save key"}
          </Button>
        </div>
      ) : null}
      {error ? <p className="font-mono text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function ConnectorsSection() {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const { items, state } = useJsonList(`/api/rowboat/v1/connectors?r=${refreshKey}`, (data) => {
    const record = (data ?? {}) as Record<string, unknown>;
    if (Array.isArray(record.connectors)) return record.connectors;
    return Array.isArray(data) ? (data as unknown[]) : [];
  });

  const connectors: ConnectorEntry[] = items.map((item) => {
    const record = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
    return {
      name: nameOf(item),
      description: typeof record.description === "string" ? record.description : undefined,
      authType:
        record.authType === "api_key"
          ? "api_key"
          : record.authType === "oauth"
            ? "oauth"
            : undefined,
      connected: record.connected === true,
      connectedAt: typeof record.connectedAt === "string" ? record.connectedAt : null,
    };
  });

  return (
    <SettingsRow
      description="Managed connections your agents can use. OAuth connectors open a browser window; API-key connectors store the key sealed server-side."
      title="Connectors"
    >
      {state === "loading" ? (
        <EmptyCardState>Loading connectors…</EmptyCardState>
      ) : state === "error" ? (
        <EmptyCardState>Could not load connectors.</EmptyCardState>
      ) : connectors.length === 0 ? (
        <EmptyCardState>No connectors are available yet.</EmptyCardState>
      ) : (
        <div className="flex flex-col divide-y divide-primary/10">
          {connectors.map((connector) => (
            <ConnectorRow
              connector={connector}
              key={connector.name}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          ))}
        </div>
      )}
    </SettingsRow>
  );
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
      <button
        aria-checked={checked}
        aria-label={label}
        className="settings-switch shrink-0"
        onClick={() => setChecked(!checked)}
        role="switch"
        type="button"
      />
    </div>
  );
}

function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <>
      <h1 className="settings-page-title">{title}</h1>
      <p className="settings-page-description">{description}</p>
      <hr className="settings-divider" />
    </>
  );
}

const OVERVIEW_GROUPS = [
  {
    label: "Workspace",
    keys: [
      "preferences",
      "notifications",
      "permissions",
      "security",
      "extensions",
      "connections",
      "transcription",
      "note-tagging",
      "advanced",
    ],
  },
  {
    label: "Global",
    keys: [
      "models",
      "code-mode",
      "customization",
      "appearance",
      "mcp",
      "environment",
      "updates",
      "memory",
      "recovery",
    ],
  },
  { label: "Cloud", keys: ["account", "connect"] },
  { label: "Support", keys: ["help"] },
] as const;

function OverviewSection({ onNavigate }: { onNavigate: (section: SettingsSection) => void }) {
  return (
    <>
      <PageIntro
        description="Configure how Oppulence reasons, connects, and acts across every customer relationship."
        title="Settings"
      />
      {OVERVIEW_GROUPS.map((group) => (
        <section className="settings-overview-group" key={group.label}>
          <h2 className="settings-overview-label">{group.label}</h2>
          <div className="settings-card-grid">
            {group.keys.map((key) => {
              const section = SETTINGS_SECTIONS.find((item) => item.key === key);
              if (!section) return null;
              return (
                <button
                  className="settings-card"
                  key={section.key}
                  onClick={() => onNavigate(section.key)}
                  type="button"
                >
                  <span className="settings-card-icon">
                    <section.icon />
                  </span>
                  <span className="settings-card-copy">
                    <span className="settings-card-title">{section.label}</span>
                    <span className="settings-card-description">{section.description}</span>
                  </span>
                  <ArrowRight className="ml-auto size-3.5 shrink-0 text-primary/30" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <section className="settings-overview-group">
        <h2 className="settings-overview-label">Help</h2>
        <div className="settings-card-grid">
          {[
            {
              title: "Send feedback",
              description: "Tell us where relationship intelligence should go next.",
              icon: Bell,
              href: "mailto:hello@oppulence.io?subject=Oppulence%20feedback",
            },
            {
              title: "Read the documentation",
              description: "Review the relationship model and API reference.",
              icon: BookOpen,
              href: "/api/reference",
            },
          ].map((item) => (
            <button
              className="settings-card"
              key={item.title}
              onClick={() => window.open(item.href, "_blank")}
              type="button"
            >
              <span className="settings-card-icon">
                <item.icon />
              </span>
              <span className="settings-card-copy">
                <span className="settings-card-title">{item.title}</span>
                <span className="settings-card-description">{item.description}</span>
              </span>
              <ArrowRight className="ml-auto size-3.5 shrink-0 text-primary/30" />
            </button>
          ))}
        </div>
      </section>
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
          <select
            aria-label="Notification level"
            className="settings-select w-40"
            defaultValue={getPref("notification-level") || "off"}
            onChange={(event) => setPref("notification-level", event.target.value)}
          >
            <option value="off">Off</option>
            <option value="attention">Needs attention</option>
            <option value="all">All relationship changes</option>
          </select>
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
          <select
            aria-label="Notification level"
            className="settings-select w-40"
            defaultValue={getPref("notification-level") || "off"}
            onChange={(event) => setPref("notification-level", event.target.value)}
          >
            <option value="off">Off</option>
            <option value="attention">Needs attention</option>
            <option value="all">All relationship changes</option>
          </select>
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
          <span className="settings-status settings-status--ok">Authorized</span>
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

function DesktopCapabilitySection({
  description,
  detail,
  title,
}: {
  description: string;
  detail: string;
  title: string;
}) {
  return (
    <>
      <PageIntro description={description} title={title} />
      <div className="settings-inline-notice">
        This existing setting remains fully configurable in the Oppulence desktop app.
      </div>
      <SettingsRow
        description="Desktop-only controls stay local because they can access files, audio, and agent runtimes."
        title="Desktop configuration"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">{title}</p>
            <p className="settings-row-description">{detail}</p>
          </div>
          <span className="settings-status">Desktop app</span>
        </div>
      </SettingsRow>
    </>
  );
}

function MemorySection() {
  return (
    <>
      <PageIntro
        description="Manage the private semantic memory used to recall approved relationship evidence."
        title="Memory"
      />
      <SettingsRow
        description="This browser preference controls whether semantic memory is available to the console."
        title="Memory Bank"
      >
        <PreferenceToggle
          description="Build a private semantic memory from approved relationship evidence."
          label="Memory Bank (preview)"
          storageKey="settings-memory-bank"
        />
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
          <button
            className="settings-card"
            key={item.title}
            onClick={() => window.open(item.href, "_blank")}
            type="button"
          >
            <span className="settings-card-icon">
              <item.icon />
            </span>
            <span className="settings-card-copy">
              <span className="settings-card-title">{item.title}</span>
              <span className="settings-card-description">{item.description}</span>
            </span>
            <ArrowRight className="ml-auto size-3.5 shrink-0 text-primary/30" />
          </button>
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
          <span className="settings-status settings-status--ok">Authorized</span>
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
            <input
              className="settings-control min-w-0 flex-1"
              id="settings-app-name"
              onChange={(event) => setAppName(event.target.value)}
              value={appName}
            />
            <button
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
            </button>
          </div>
        </div>
      </SettingsRow>
      <SettingsRow
        description="Preview the same relationship workspace used by the desktop app."
        title="Layout"
      >
        <div className="settings-preview">
          <img alt="Oppulence relationship workspace" src="/marketing/desktop-home.png" />
        </div>
        {[
          [sidebar, setSidebar, "Display sidebar", "Keep relationship navigation visible."],
          [statusBar, setStatusBar, "Display status bar", "Show connection and sync state."],
          [docs, setDocs, "Display documentation link", "Keep product docs in the app rail."],
          [
            feedback,
            setFeedback,
            "Display feedback button",
            "Make feedback available to the team.",
          ],
        ].map(([checked, setter, label, description]) => (
          <div className="settings-row" key={String(label)}>
            <div className="settings-row-copy">
              <p className="settings-row-label">{String(label)}</p>
              <p className="settings-row-description">{String(description)}</p>
            </div>
            <button
              aria-checked={Boolean(checked)}
              aria-label={String(label)}
              className="settings-switch"
              onClick={() => (setter as (next: boolean) => void)(!checked)}
              role="switch"
              type="button"
            />
          </div>
        ))}
      </SettingsRow>
    </>
  );
}

function EnvironmentSection() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <>
      <PageIntro
        description="Inspect the endpoints and browser runtime used by this console."
        title="Environment"
      />
      <SettingsRow
        description="These values are detected from the running application."
        title="Runtime"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Console origin</p>
            <p className="settings-row-description font-mono">{origin}</p>
          </div>
          <span className="settings-status settings-status--ok">Connected</span>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Relationship API</p>
            <p className="settings-row-description font-mono">
              {origin}/api/rowboat/v1/relationships
            </p>
          </div>
          <Cloud className="size-4 text-primary/40" />
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Client runtime</p>
            <p className="settings-row-description">
              {typeof navigator === "undefined" ? "Browser" : navigator.userAgent}
            </p>
          </div>
          <Monitor className="size-4 text-primary/40" />
        </div>
      </SettingsRow>
    </>
  );
}

function UpdatesSection() {
  const [automatic, setAutomatic] = useStoredBoolean("settings-update-checks", true);
  const [download, setDownload] = useStoredBoolean("settings-update-downloads", false);
  const [checked, setChecked] = React.useState(false);

  return (
    <>
      <PageIntro
        description="Keep the console current with quiet background checks and controlled installs."
        title="Updates"
      />
      <SettingsRow
        description="The web console is deployed continuously; this view records your release preferences."
        title="Current version"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Oppulence web</p>
            <p className="settings-row-description">
              {checked ? "You are on the latest available deployment." : "Production channel"}
            </p>
          </div>
          <button className="settings-button" onClick={() => setChecked(true)} type="button">
            {checked ? <Check className="size-3.5" /> : null}
            {checked ? "Up to date" : "Check now"}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Release channel</p>
            <p className="settings-row-description">Stable releases only.</p>
          </div>
          <select className="settings-select w-32" defaultValue="stable">
            <option value="stable">Stable</option>
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Check automatically</p>
            <p className="settings-row-description">Look for new deployments in the background.</p>
          </div>
          <button
            aria-checked={automatic}
            aria-label="Check automatically"
            className="settings-switch"
            onClick={() => setAutomatic(!automatic)}
            role="switch"
            type="button"
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Download automatically</p>
            <p className="settings-row-description">
              Reserved for desktop releases; the preference stays in sync here.
            </p>
          </div>
          <button
            aria-checked={download}
            aria-label="Download automatically"
            className="settings-switch"
            onClick={() => setDownload(!download)}
            role="switch"
            type="button"
          />
        </div>
      </SettingsRow>
    </>
  );
}

function RecoverySection() {
  const [reset, setReset] = React.useState(false);
  return (
    <>
      <PageIntro
        description="Recover a clean local experience without deleting relationship data."
        title="Recovery"
      />
      <SettingsRow
        description="Relationship records and source evidence remain safely in the workspace."
        title="Local console"
      >
        <div className="settings-row">
          <div className="settings-row-copy">
            <p className="settings-row-label">Reset local settings</p>
            <p className="settings-row-description">
              Clears theme, display, notification, and customization preferences in this browser.
            </p>
          </div>
          <button
            className="settings-button"
            onClick={() => {
              Object.keys(localStorage)
                .filter((key) => key === "theme" || key.startsWith("settings-"))
                .forEach((key) => localStorage.removeItem(key));
              setReset(true);
            }}
            type="button"
          >
            {reset ? "Reset complete" : "Reset local settings"}
          </button>
        </div>
      </SettingsRow>
      <div className="settings-inline-notice">
        Recovery never removes relationship timelines, observations, assertions, or source
        connections from your organization.
      </div>
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
      <SettingsRow danger title="Session">
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
        {section === "extensions" ? (
          <>
            <PageIntro description={current.description} title={current.label} />
            <ConnectorsSection />
          </>
        ) : null}
        {section === "connections" ? (
          <>
            <PageIntro description={current.description} title={current.label} />
            <ConnectorsSection />
          </>
        ) : null}
        {section === "transcription" ? (
          <DesktopCapabilitySection
            description={current.description}
            detail="Choose on-device or cloud speech-to-text and configure the transcription provider."
            title={current.label}
          />
        ) : null}
        {section === "note-tagging" ? (
          <DesktopCapabilitySection
            description={current.description}
            detail="Edit note tags, email labels, examples, applicability, and note-creation behavior."
            title={current.label}
          />
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
                <span className="settings-status settings-status--ok">Default</span>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <p className="settings-row-label">Relationship API</p>
                  <p className="settings-row-description font-mono">
                    /api/rowboat/v1/relationships
                  </p>
                </div>
                <span className="settings-status settings-status--ok">Available</span>
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
                <button
                  className="settings-button"
                  onClick={() => window.location.reload()}
                  type="button"
                >
                  Refresh
                </button>
              </div>
            </SettingsRow>
          </>
        ) : null}
        {section === "models" ? (
          <>
            <PageIntro description={current.description} title={current.label} />
            <ModelsSection />
          </>
        ) : null}
        {section === "code-mode" ? (
          <DesktopCapabilitySection
            description={current.description}
            detail="Choose the coding agent and approval policy used for delegated code execution."
            title={current.label}
          />
        ) : null}
        {section === "customization" ? <CustomizationSection /> : null}
        {section === "appearance" ? <AppearanceSection /> : null}
        {section === "mcp" ? (
          <DesktopCapabilitySection
            description={current.description}
            detail="Add, enable, disable, and inspect local or remote MCP server connections."
            title={current.label}
          />
        ) : null}
        {section === "environment" ? <EnvironmentSection /> : null}
        {section === "updates" ? <UpdatesSection /> : null}
        {section === "memory" ? <MemorySection /> : null}
        {section === "recovery" ? <RecoverySection /> : null}
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
            <ConnectorsSection />
          </>
        ) : null}
        {section === "help" ? <HelpSection /> : null}
      </div>
    </div>
  );
}
