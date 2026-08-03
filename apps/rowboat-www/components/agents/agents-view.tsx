"use client";

import * as React from "react";
import {
  ArrowClockwise,
  ChatCircle,
  CircleNotch,
  Code,
  Copy,
  Folder,
  Plus,
  Robot,
  Warning,
} from "@phosphor-icons/react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@oppulence/ui/components/dialog";
import { Input } from "@oppulence/ui/components/input";
import { Label } from "@oppulence/ui/components/label";
import { ScrollArea } from "@oppulence/ui/components/scroll-area";
import { Separator } from "@oppulence/ui/components/separator";
import { Textarea } from "@oppulence/ui/components/textarea";

import { dashboardFetch } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

type AgentSummary = {
  slug: string;
  name: string;
  source: string;
  instructions?: string;
  model?: string;
  provider?: string;
  enabledTools?: string[];
  subagentRefs?: string[];
  connectorReqs?: string[];
  limits?: Record<string, unknown>;
};

function parseAgents(value: unknown): AgentSummary[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { agents?: unknown }).agents;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap<AgentSummary>((row): AgentSummary[] => {
    if (typeof row === "string") {
      return [{ slug: row, name: row, source: "unknown", enabledTools: [] }];
    }
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    if (typeof record.slug !== "string" || !record.slug) return [];
    return [
      {
        slug: record.slug,
        name: typeof record.name === "string" && record.name ? record.name : record.slug,
        source: typeof record.source === "string" ? record.source : "unknown",
        instructions: typeof record.instructions === "string" ? record.instructions : undefined,
        model: typeof record.model === "string" ? record.model : undefined,
        provider: typeof record.provider === "string" ? record.provider : undefined,
        enabledTools: Array.isArray(record.enabledTools)
          ? record.enabledTools.filter((tool): tool is string => typeof tool === "string")
          : [],
        subagentRefs: Array.isArray(record.subagentRefs)
          ? record.subagentRefs.filter((slug): slug is string => typeof slug === "string")
          : [],
        connectorReqs: Array.isArray(record.connectorReqs)
          ? record.connectorReqs.filter((scope): scope is string => typeof scope === "string")
          : [],
        limits:
          record.limits && typeof record.limits === "object"
            ? (record.limits as Record<string, unknown>)
            : undefined,
      },
    ];
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function CreateAgentDialog({
  onCreated,
  source,
}: {
  onCreated: (slug: string) => void;
  source?: AgentSummary;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [instructions, setInstructions] = React.useState("");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    const initialName = source ? `${source.name} copy` : "";
    setName(initialName);
    setSlug(source ? `${source.slug}-copy` : "");
    setInstructions(source?.instructions || "");
    setSlugEdited(false);
    setError(null);
  }, [source]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) reset();
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await dashboardFetch("/api/rowboat/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          name: name.trim(),
          instructions: instructions.trim(),
          model: source?.model || "",
          provider: source?.provider || "",
          enabledTools: source?.enabledTools || [],
          subagentRefs: source?.subagentRefs || [],
          connectorReqs: source?.connectorReqs || [],
          limits: source?.limits || {},
          ...(source ? { forkedFrom: source.slug } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : `Could not create agent (${response.status})`;
        throw new Error(message);
      }
      setOpen(false);
      onCreated(slug.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create agent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant={source ? "outline" : "default"}>
          {source ? <Copy className="size-4" /> : <Plus className="size-4" />}
          {source ? "Duplicate" : "New agent"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{source ? `Customize ${source.name}` : "Create an agent"}</DialogTitle>
          <DialogDescription>
            {source
              ? "Create an editable workspace copy, then adjust its model, tools, and safeguards."
              : "Start with a name and purpose. You can choose tools and limits next."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-agent-name">Display name</Label>
            <Input
              autoFocus
              id="new-agent-name"
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!slugEdited) setSlug(slugify(nextName));
              }}
              placeholder="Customer concierge"
              value={name}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-agent-slug">Agent ID</Label>
            <Input
              className="font-mono"
              id="new-agent-slug"
              onChange={(event) => {
                setSlug(slugify(event.target.value));
                setSlugEdited(true);
              }}
              placeholder="customer-concierge"
              value={slug}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, hyphens, and underscores only.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-agent-instructions">Purpose</Label>
            <Textarea
              className="min-h-28"
              id="new-agent-instructions"
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Explain what this agent should accomplish and how it should behave."
              value={instructions}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            disabled={busy || !name.trim() || !slug.trim() || !instructions.trim()}
            onClick={() => void create()}
          >
            {busy ? <CircleNotch className="size-4 animate-spin" /> : <Robot className="size-4" />}
            {source ? "Create copy" : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentsView({
  onOpenDefinition,
  onUseAgent,
}: {
  onOpenDefinition: (slug: string) => void;
  onUseAgent: (slug: string) => void;
}) {
  const [agents, setAgents] = React.useState<AgentSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await dashboardFetch("/api/rowboat/v1/agents");
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : `Could not load agents (${response.status})`;
        throw new Error(message);
      }
      const nextAgents = parseAgents(body);
      setAgents(nextAgents);
      setSelectedSlug((current) =>
        nextAgents.some((agent) => agent.slug === current) ? current : nextAgents[0]?.slug || "",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selected = agents.find((agent) => agent.slug === selectedSlug) || null;
  const handleCreated = async (slug: string) => {
    await load();
    setSelectedSlug(slug);
    onOpenDefinition(slug);
  };

  if (loading && agents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <CircleNotch className="size-4 animate-spin" /> Loading agents
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Robot className="size-5 text-oppulence-orange" weight="fill" />
            <h1 className="text-sm font-medium">Agents</h1>
            <Badge variant="secondary">{agents.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Inspect the agents available to this workspace, their instructions, and permitted tools.
          </p>
        </div>
        <div className="flex gap-2">
          <Button disabled={loading} onClick={() => void load()} size="sm" variant="outline">
            <ArrowClockwise className={cn("size-4", loading && "animate-spin")} /> Refresh
          </Button>
          <CreateAgentDialog onCreated={(slug) => void handleCreated(slug)} />
        </div>
      </div>

      {error ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          <span className="flex items-center gap-2">
            <Warning className="size-4" /> {error}
          </span>
          <Button onClick={() => void load()} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      ) : null}

      {agents.length === 0 && !error ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-sm">
            <Folder className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-medium">No agents are available</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Agent definitions will appear here after they are provisioned for this workspace.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
          <aside className="min-h-0 border-r bg-muted/10">
            <ScrollArea className="h-full p-2">
              <div className="space-y-1">
                {agents.map((agent) => (
                  <button
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted",
                      selected?.slug === agent.slug && "bg-muted",
                    )}
                    key={agent.slug}
                    onClick={() => setSelectedSlug(agent.slug)}
                    type="button"
                  >
                    <Robot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{agent.name}</span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                        {agent.slug}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </aside>

          <ScrollArea className="min-h-0">
            {selected ? (
              <div className="mx-auto max-w-4xl space-y-5 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-medium tracking-tight">{selected.name}</h2>
                      <Badge variant="outline">{selected.source}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.slug}</p>
                  </div>
                  <div className="flex gap-2">
                    <CreateAgentDialog
                      onCreated={(slug) => void handleCreated(slug)}
                      source={selected}
                    />
                    <Button onClick={() => onOpenDefinition(selected.slug)} size="sm" variant="outline">
                      <Code className="size-4" />
                      {selected.source === "tenant" ? "Configure" : "View configuration"}
                    </Button>
                    <Button onClick={() => onUseAgent(selected.slug)} size="sm">
                      <ChatCircle className="size-4" /> Use in chat
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border p-4">
                    <p className="text-xs text-muted-foreground">Provider</p>
                    <p className="mt-1 text-sm">{selected.provider || "Workspace default"}</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-xs text-muted-foreground">Model</p>
                    <p className="mt-1 text-sm">{selected.model || "Workspace default"}</p>
                  </div>
                </div>

                <section>
                  <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Instructions
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/20 p-4 text-sm leading-6">
                    {selected.instructions || "No additional instructions."}
                  </p>
                </section>

                <section>
                  <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Enabled tools
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.enabledTools?.length ? (
                      selected.enabledTools.map((tool) => (
                        <Badge className="font-mono" key={tool} variant="secondary">
                          {tool}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No tools enabled.</span>
                    )}
                  </div>
                </section>

                {selected.subagentRefs?.length || selected.connectorReqs?.length ? (
                  <section className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-muted-foreground">Subagents</p>
                      <p className="mt-1 text-sm">{selected.subagentRefs?.join(", ") || "None"}</p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <p className="text-xs text-muted-foreground">Required connections</p>
                      <p className="mt-1 text-sm">{selected.connectorReqs?.join(", ") || "None"}</p>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
