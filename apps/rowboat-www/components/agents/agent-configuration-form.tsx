"use client";

import * as React from "react";
import { Plus, Robot, ShieldCheck, Wrench, X } from "@phosphor-icons/react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@oppulence/ui/components/accordion";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";
import { Label } from "@oppulence/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { Switch } from "@oppulence/ui/components/switch";
import { Textarea } from "@oppulence/ui/components/textarea";

import { dashboardFetch } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

type AgentTool =
  | string
  | {
      name: string;
      kind?: "openapi" | "mcp";
      manifestRef?: string;
      requiresApproval?: boolean;
    };

type AgentDocument = {
  apiVersion: "agent.rowboat.dev/v1";
  kind: "Agent";
  metadata: {
    slug: string;
    name: string;
  };
  spec: {
    model?: string;
    provider?: string;
    instructions?: string;
    tools?: AgentTool[];
    connections?: Array<{ scope: string }>;
    subagents?: string[];
    limits?: {
      maxTurns?: number;
      maxLLMCalls?: number;
      maxToolCalls?: number;
      spendCeilingUsd?: number;
    };
    [key: string]: unknown;
  };
};

const TOOL_CATALOG = [
  { name: "current_time", label: "Current time", description: "Read the current UTC date and time." },
  { name: "web.search", label: "Web search", description: "Search the web for current information." },
  { name: "echo", label: "Echo", description: "Test that tool calls are wired correctly." },
  { name: "tool_result.read", label: "Tool results", description: "Read results produced by another tool." },
  { name: "slack.read_thread", label: "Read Slack", description: "Read messages from a Slack thread." },
  { name: "slack.post_message", label: "Post to Slack", description: "Send a Slack message with approval controls." },
  { name: "connector.read.gmail", label: "Read Gmail", description: "Read connected Gmail messages." },
  { name: "connector.write.gmail_draft", label: "Draft email", description: "Create a Gmail draft for review." },
  { name: "connector.write.gmail_send", label: "Send email", description: "Send Gmail messages with approval controls." },
  { name: "connector.read.calendar", label: "Read calendar", description: "Read connected calendar events." },
  { name: "connector.write.calendar_create", label: "Create event", description: "Create a calendar event." },
  { name: "connector.write.calendar_update", label: "Update event", description: "Update an existing calendar event." },
  { name: "connector.read.drive", label: "Read Drive", description: "Read connected Drive files." },
  { name: "connector.write.drive_update", label: "Update Drive", description: "Update connected Drive files." },
  { name: "connector.read.hubspot_search", label: "Search HubSpot", description: "Find records in the connected HubSpot account." },
  { name: "connector.write.hubspot_note", label: "Add HubSpot note", description: "Attach a note to a HubSpot record." },
  { name: "connector.write.hubspot_task", label: "Create HubSpot task", description: "Create a follow-up task in HubSpot." },
  { name: "conduit.read", label: "Read Conduit", description: "Read revenue context from Conduit." },
  { name: "eigen.simulate", label: "Run simulation", description: "Run an Eigen scenario simulation." },
  { name: "demo.payment", label: "Payment demo", description: "Exercise approval flows without moving real funds." },
] as const;

function parseDocument(content: string): AgentDocument | null {
  try {
    const value = JSON.parse(content) as AgentDocument;
    if (
      value?.apiVersion !== "agent.rowboat.dev/v1" ||
      value?.kind !== "Agent" ||
      !value.metadata ||
      !value.spec
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function toolName(tool: AgentTool): string {
  return typeof tool === "string" ? tool : tool.name;
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-5 text-muted-foreground">{children}</p>;
}

function TagEditor({
  addLabel,
  disabled,
  emptyLabel,
  onChange,
  placeholder,
  values,
}: {
  addLabel: string;
  disabled: boolean;
  emptyLabel: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  values: string[];
}) {
  const [draft, setDraft] = React.useState("");

  const add = () => {
    const next = draft.trim();
    if (!next || values.includes(next)) return;
    onChange([...values, next]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge className="gap-1.5 py-1 pl-2.5 pr-1 font-mono font-normal" key={value} variant="secondary">
              {value}
              {!disabled ? (
                <button
                  aria-label={`Remove ${value}`}
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  onClick={() => onChange(values.filter((candidate) => candidate !== value))}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      )}

      {!disabled ? (
        <div className="flex max-w-md gap-2">
          <Input
            aria-label={addLabel}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            value={draft}
          />
          <Button disabled={!draft.trim()} onClick={add} size="sm" type="button" variant="outline">
            <Plus className="size-4" /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function AgentConfigurationForm({
  agentSlugs,
  content,
  onChange,
  readOnly,
}: {
  agentSlugs: string[];
  content: string;
  onChange: (content: string) => void;
  readOnly: boolean;
}) {
  const document = React.useMemo(() => parseDocument(content), [content]);
  const [modelOptions, setModelOptions] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        const response = await dashboardFetch("/api/rowboat/v1/llm/models");
        if (!response.ok) return;
        const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
        const ids = Array.isArray(body.data)
          ? body.data.flatMap((item) => (typeof item?.id === "string" ? [item.id] : []))
          : [];
        if (!cancelled) setModelOptions(ids);
      } catch {
        // A free-form model field remains available when the catalog is offline.
      }
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = React.useCallback(
    (mutate: (next: AgentDocument) => void) => {
      if (!document || readOnly) return;
      const next = JSON.parse(JSON.stringify(document)) as AgentDocument;
      mutate(next);
      onChange(JSON.stringify(next, null, 2));
    },
    [document, onChange, readOnly],
  );

  if (!document) {
    return (
      <div className="m-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        This agent definition could not be displayed. Refresh it and try again.
      </div>
    );
  }

  const selectedTools = (document.spec.tools || []).map(toolName);
  const customTools = selectedTools.filter(
    (name) => !TOOL_CATALOG.some((tool) => tool.name === name),
  );
  const selectedSubagents = document.spec.subagents || [];
  const connectionScopes = (document.spec.connections || []).map((connection) => connection.scope);
  const limits = document.spec.limits || {};
  const availableSubagents = agentSlugs.filter((slug) => slug !== document.metadata.slug);

  const setString = (field: "model" | "provider" | "instructions", value: string) => {
    update((next) => {
      if (value || field === "instructions") next.spec[field] = value;
      else delete next.spec[field];
    });
  };

  const setTools = (names: string[]) => {
    update((next) => {
      const current = next.spec.tools || [];
      next.spec.tools = names.map(
        (name) => current.find((tool) => toolName(tool) === name) || name,
      );
    });
  };

  const setLimit = (field: keyof NonNullable<AgentDocument["spec"]["limits"]>, raw: string) => {
    update((next) => {
      const nextLimits = { ...(next.spec.limits || {}) };
      if (raw === "") delete nextLimits[field];
      else nextLimits[field] = Number(raw);
      if (Object.keys(nextLimits).length) next.spec.limits = nextLimits;
      else delete next.spec.limits;
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl divide-y">
      <section className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-oppulence-orange/10 p-2 text-oppulence-orange">
            <Robot className="size-5" weight="fill" />
          </div>
          <div>
            <h3 className="text-sm font-medium">Identity and behavior</h3>
            <FieldHint>Give the agent a clear name and tell it how to work.</FieldHint>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Display name</Label>
            <Input
              disabled={readOnly}
              id="agent-name"
              onChange={(event) =>
                update((next) => {
                  next.metadata.name = event.target.value;
                })
              }
              placeholder="Customer concierge"
              value={document.metadata.name}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-slug">Agent ID</Label>
            <Input disabled id="agent-slug" value={document.metadata.slug} />
            <FieldHint>The ID is fixed after an agent is created.</FieldHint>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-instructions">Instructions</Label>
          <Textarea
            className="min-h-44 resize-y leading-6"
            disabled={readOnly}
            id="agent-instructions"
            onChange={(event) => setString("instructions", event.target.value)}
            placeholder="Describe the agent’s role, priorities, tone, and boundaries in plain language."
            value={document.spec.instructions || ""}
          />
          <FieldHint>Use plain language. These instructions guide every conversation this agent handles.</FieldHint>
        </div>
      </section>

      <section className="space-y-5 p-5 sm:p-6">
        <div>
          <h3 className="text-sm font-medium">AI model</h3>
          <FieldHint>Leave these blank to use the workspace defaults.</FieldHint>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agent-provider">Provider</Label>
            <Input
              disabled={readOnly}
              id="agent-provider"
              onChange={(event) => setString("provider", event.target.value)}
              placeholder="Workspace default"
              value={document.spec.provider || ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-model">Model</Label>
            {modelOptions.length ? (
              <Select
                disabled={readOnly}
                onValueChange={(value) => setString("model", value === "workspace-default" ? "" : value)}
                value={document.spec.model || "workspace-default"}
              >
                <SelectTrigger className="w-full" id="agent-model">
                  <SelectValue placeholder="Workspace default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace-default">Workspace default</SelectItem>
                  {document.spec.model && !modelOptions.includes(document.spec.model) ? (
                    <SelectItem value={document.spec.model}>{document.spec.model}</SelectItem>
                  ) : null}
                  {modelOptions.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                disabled={readOnly}
                id="agent-model"
                onChange={(event) => setString("model", event.target.value)}
                placeholder="Workspace default"
                value={document.spec.model || ""}
              />
            )}
          </div>
        </div>
      </section>

      <section className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-muted p-2 text-muted-foreground">
            <Wrench className="size-5" />
          </div>
          <div>
            <h3 className="text-sm font-medium">Tools</h3>
            <FieldHint>Choose only the capabilities this agent needs.</FieldHint>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {TOOL_CATALOG.map((tool) => {
            const checked = selectedTools.includes(tool.name);
            return (
              <label
                className={cn(
                  "flex min-h-16 items-start justify-between gap-3 rounded-lg border p-3 transition-colors",
                  checked && "border-oppulence-orange/40 bg-oppulence-orange/5",
                  !readOnly && "cursor-pointer hover:bg-muted/40",
                )}
                key={tool.name}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{tool.label}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                    {tool.description}
                  </span>
                </span>
                <Switch
                  checked={checked}
                  disabled={readOnly}
                  onCheckedChange={(enabled) =>
                    setTools(
                      enabled
                        ? [...selectedTools, tool.name]
                        : selectedTools.filter((name) => name !== tool.name),
                    )
                  }
                />
              </label>
            );
          })}
        </div>

        <div className="space-y-2 rounded-lg border border-dashed p-4">
          <Label>Custom tools</Label>
          <FieldHint>Add an approved tool by its registered name.</FieldHint>
          <TagEditor
            addLabel="Custom tool name"
            disabled={readOnly}
            emptyLabel="No custom tools added."
            onChange={(nextCustomTools) =>
              setTools([
                ...selectedTools.filter((name) => !customTools.includes(name)),
                ...nextCustomTools,
              ])
            }
            placeholder="connector.custom.action"
            values={customTools}
          />
        </div>
      </section>

      <section className="space-y-5 p-5 sm:p-6">
        <div>
          <h3 className="text-sm font-medium">Team and connections</h3>
          <FieldHint>Allow delegation to another agent or declare connected-service access.</FieldHint>
        </div>

        <div className="space-y-3">
          <Label>Can delegate to</Label>
          {availableSubagents.length ? (
            <div className="flex flex-wrap gap-2">
              {availableSubagents.map((slug) => {
                const selected = selectedSubagents.includes(slug);
                return (
                  <Button
                    aria-pressed={selected}
                    className={cn(selected && "border-oppulence-orange/40 bg-oppulence-orange/5")}
                    disabled={readOnly}
                    key={slug}
                    onClick={() =>
                      update((next) => {
                        const subagents = next.spec.subagents || [];
                        next.spec.subagents = selected
                          ? subagents.filter((candidate) => candidate !== slug)
                          : [...subagents, slug];
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Robot className="size-4" /> {slug}
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No other agents are available.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Required connection scopes</Label>
          <FieldHint>Scopes describe what a connected service may do; they never contain credentials.</FieldHint>
          <TagEditor
            addLabel="Connection scope"
            disabled={readOnly}
            emptyLabel="This agent does not require a connected service."
            onChange={(scopes) =>
              update((next) => {
                next.spec.connections = scopes.map((scope) => ({ scope }));
              })
            }
            placeholder="slack:messages.read"
            values={connectionScopes}
          />
        </div>
      </section>

      <section className="p-5 sm:p-6">
        <Accordion collapsible type="single">
          <AccordionItem className="rounded-lg border px-4" value="limits">
            <AccordionTrigger className="hover:no-underline">
              <span className="flex items-center gap-3">
                <ShieldCheck className="size-5 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Advanced run limits</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Optional safeguards; blank fields inherit workspace limits.
                  </span>
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
                {(
                  [
                    ["maxTurns", "Maximum turns", "20"],
                    ["maxLLMCalls", "Maximum AI calls", "50"],
                    ["maxToolCalls", "Maximum tool calls", "25"],
                    ["spendCeilingUsd", "Spend ceiling (USD)", "5.00"],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <div className="space-y-2" key={field}>
                    <Label htmlFor={`agent-${field}`}>{label}</Label>
                    <Input
                      disabled={readOnly}
                      id={`agent-${field}`}
                      min="0"
                      onChange={(event) => setLimit(field, event.target.value)}
                      placeholder={placeholder}
                      step={field === "spendCeilingUsd" ? "0.01" : "1"}
                      type="number"
                      value={limits[field] ?? ""}
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    </div>
  );
}
