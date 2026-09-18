"use client";

import * as React from "react";
import {
  ArrowClockwise,
  ChatCircle,
  CircleNotch,
  Code,
  Copy,
  Plus,
  Robot,
  Trash,
  Warning,
} from "@/lib/icons";

import { Alert, AlertDescription, AlertTitle } from "@oppulence/ui/components/alert";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { CardDescription } from "@oppulence/ui/components/card";
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
import { Textarea } from "@oppulence/ui/components/textarea";
import { WorkspaceEmptyState } from "@/components/revenue/shared";

import { dashboardFetch } from "@/lib/auth/client";
import { parseAgentsResponse, type AgentSummary } from "@/lib/agents/agent-schemas";
import { cn } from "@/lib/utils";

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
        <Button
          aria-label={source ? `Duplicate ${source.name}` : undefined}
          size={source ? "icon-xs" : "sm"}
          title={source ? "Duplicate agent" : undefined}
          variant={source ? "ghost" : "default"}
        >
          {source ? <Copy className="size-4" /> : <Plus className="size-4" />}
          {source ? null : "New agent"}
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
  onAgentsChanged,
  onOpenDefinition,
  onUseAgent,
}: {
  onAgentsChanged: () => Promise<void>;
  onOpenDefinition: (slug: string) => void;
  onUseAgent: (slug: string) => void;
}) {
  const [agents, setAgents] = React.useState<AgentSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

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
      const nextAgents = parseAgentsResponse(body);
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
    await onAgentsChanged();
    setSelectedSlug(slug);
    onOpenDefinition(slug);
  };

  const deleteAgent = async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await dashboardFetch(`/api/rowboat/v1/agents/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`Could not delete agent (${response.status})`);
      setConfirmingDelete(false);
      await Promise.all([load(), onAgentsChanged()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete agent");
      setLoading(false);
    }
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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <p className="text-sm text-muted-foreground">
          {agents.length} {agents.length === 1 ? "agent" : "agents"} in this workspace
        </p>
        <div className="flex gap-2">
          <Button
            aria-label="Refresh agents"
            disabled={loading}
            onClick={() => void load()}
            size="icon-xs"
            title="Refresh agents"
            variant="ghost"
          >
            <ArrowClockwise className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <CreateAgentDialog onCreated={(slug) => void handleCreated(slug)} />
        </div>
      </div>

      {error ? (
        <Alert className="shrink-0 rounded-none border-x-0 border-t-0" variant="destructive">
          <Warning className="size-4" />
          <AlertTitle className="text-xs">Could not load agents</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 text-xs">
            {error}
            <Button onClick={() => void load()} size="sm" variant="outline">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {agents.length === 0 && !error ? (
        <WorkspaceEmptyState
          description="Create an agent to give recurring work a clear role, instructions, and tools."
          image="agents"
          learnMore={[
            { label: "Give each agent one clear responsibility" },
            { label: "Control the tools each agent can use" },
          ]}
          title="Agents"
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] md:grid-rows-1">
          <aside className="max-h-52 min-h-0 border-b bg-muted/5 md:max-h-none md:border-r md:border-b-0">
            <ScrollArea className="h-full p-2">
              <div className="space-y-1">
                {agents.map((agent) => (
                  <Button
                    className={cn(
                      "h-auto w-full items-start justify-start gap-2 rounded-none px-3 py-2.5 text-left transition-colors hover:bg-muted/70",
                      selected?.slug === agent.slug && "bg-muted/70",
                    )}
                    key={agent.slug}
                    onClick={() => {
                      setSelectedSlug(agent.slug);
                      setConfirmingDelete(false);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <Robot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <Label className="block truncate text-sm font-medium">{agent.name}</Label>
                      <CardDescription className="mt-0.5 block truncate font-mono text-[11px]">
                        {agent.slug}
                      </CardDescription>
                    </div>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </aside>

          <ScrollArea className="min-h-0">
            {selected ? (
              <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-medium tracking-tight">{selected.name}</h2>
                      <Badge variant="outline">{selected.source}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.slug}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {selected.source === "tenant" ? (
                      confirmingDelete ? (
                        <>
                          <Button
                            disabled={loading}
                            onClick={() => void deleteAgent(selected.slug)}
                            size="sm"
                            variant="destructive"
                          >
                            Confirm delete
                          </Button>
                          <Button
                            disabled={loading}
                            onClick={() => setConfirmingDelete(false)}
                            size="sm"
                            variant="ghost"
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          aria-label={`Delete ${selected.name}`}
                          onClick={() => setConfirmingDelete(true)}
                          size="icon-xs"
                          title="Delete agent"
                          variant="ghost"
                        >
                          <Trash className="size-4" />
                        </Button>
                      )
                    ) : null}
                    <CreateAgentDialog
                      onCreated={(slug) => void handleCreated(slug)}
                      source={selected}
                    />
                    <Button
                      onClick={() => onOpenDefinition(selected.slug)}
                      size="sm"
                      variant="outline"
                    >
                      <Code className="size-4" />
                      {selected.source === "tenant" ? "Configure" : "View configuration"}
                    </Button>
                    <Button onClick={() => onUseAgent(selected.slug)} size="sm">
                      <ChatCircle className="size-4" /> Use in chat
                    </Button>
                  </div>
                </div>

                <dl className="grid gap-4 border-y py-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Provider</p>
                    <p className="mt-1 text-sm">{selected.provider || "Workspace default"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Model</p>
                    <p className="mt-1 text-sm">{selected.model || "Workspace default"}</p>
                  </div>
                </dl>

                <section>
                  <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Instructions
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap rounded-none border bg-muted/15 p-4 text-sm leading-6">
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
                      <CardDescription className="text-sm">No tools enabled.</CardDescription>
                    )}
                  </div>
                </section>

                {selected.subagentRefs?.length || selected.connectorReqs?.length ? (
                  <section className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Subagents</p>
                      <p className="mt-1 text-sm">{selected.subagentRefs?.join(", ") || "None"}</p>
                    </div>
                    <div>
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
