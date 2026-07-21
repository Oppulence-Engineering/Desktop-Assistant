"use client";

import * as React from "react";
import {
  Check,
  Clipboard,
  Monitor,
  Moon,
  Sun,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import {
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
    <section className="mx-auto mb-8 w-full max-w-3xl pb-8 last:mb-0 last:pb-0">
      <h2 className={cn("text-base font-medium text-primary", danger && "text-destructive")}>
        {title}
      </h2>
      {description ? <p className="text-sm text-primary/60">{description}</p> : null}
      <div
        className={cn(
          "mt-4 flex flex-col overflow-clip rounded-md border",
          danger ? "border-destructive/30 bg-destructive/5" : "dark:bg-background-100",
        )}
      >
        {children}
        {footer ? (
          <div className="flex items-center justify-end border-t bg-background-100 p-4 dark:bg-background-200">
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

function GeneralSection({ session }: { session: SessionShape }) {
  return (
    <>
      <ProfileCard />
      <DefaultsCard />
      <SettingsRow
        description="Your identity for this workspace. IDs are safe to share with support."
        title="Account"
      >
        <div className="flex flex-col gap-0.5 py-2">
          <ValueRow label="Email" value={session.user.email} />
          <ValueRow copy label="User ID" value={session.user.workosUserId || session.user.id} />
          <ValueRow copy label="Organization" value={session.user.organizationId} />
          <ValueRow label="Role" value={session.user.role} />
          <ValueRow
            label="Permissions"
            value={session.user.permissions.length ? session.user.permissions.join(", ") : null}
          />
        </div>
      </SettingsRow>
      <SettingsRow danger title="Danger Zone">
        <div className="flex items-center justify-between gap-6 p-4">
          <div>
            <p className="text-sm font-medium text-primary">Sign out</p>
            <p className="text-xs text-muted-foreground">
              End this browser session. You can sign back in with WorkOS at any time.
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
    <SettingsRow
      description="How the console looks on this device. Applies immediately."
      title="Theme"
    >
      <div className="flex flex-col divide-y divide-primary/10">
        {options.map((option) => (
          <button
            className="flex items-center justify-between gap-6 px-4 py-3 text-left transition-colors hover:bg-background-100 dark:hover:bg-background-200"
            key={option.value}
            onClick={() => setTheme(option.value)}
            type="button"
          >
            <span className="flex items-center gap-3">
              <option.icon className="size-4 text-primary/50" />
              <span>
                <span className="block text-sm font-medium text-primary">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </span>
            {theme === option.value ? <Check className="size-4 text-oppulence-orange" /> : null}
          </button>
        ))}
      </div>
    </SettingsRow>
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

/* ------------------------------- main view --------------------------------- */

export function SettingsView({
  section,
  session,
}: {
  section: SettingsSection;
  session: SessionShape;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      {section === "general" ? <GeneralSection session={session} /> : null}
      {section === "appearance" ? <AppearanceSection /> : null}
      {section === "models" ? <ModelsSection /> : null}
      {section === "connectors" ? <ConnectorsSection /> : null}
      {section === "plan" ? <PlanSection session={session} /> : null}
    </div>
  );
}
