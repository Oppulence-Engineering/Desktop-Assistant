"use client";

import * as React from "react";
import {
  ArrowClockwise,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  Cloud,
  Gear,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
  Robot,
  SlidersHorizontal,
  Warning,
  XCircle,
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
import { Progress } from "@oppulence/ui/components/progress";
import { ScrollArea } from "@oppulence/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { Separator } from "@oppulence/ui/components/separator";
import { Switch } from "@oppulence/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@oppulence/ui/components/tabs";
import { Textarea } from "@oppulence/ui/components/textarea";
import { VisualWorkflowBuilder } from "@/components/features/workflows/visual-workflow-builder/visual-workflow-builder";
import {
  cancelCloudRun,
  compileVisualWorkflow,
  createCloudTask,
  ensureFirstPartyWorkflows,
  getCloudRun,
  getCloudSchedule,
  instantiateCloudTemplate,
  listCloudRunEvents,
  listCloudRuns,
  listCloudTasks,
  listCloudTemplates,
  retryCloudRun,
  taskCron,
  taskVisualWorkflow,
  triggerCloudRun,
  updateCloudTask,
  type CloudRun,
  type CloudRunEvent,
  type CloudRunStatus,
  type CloudRunTrigger,
  type CloudSchedule,
  type CloudTask,
  type CloudTaskTemplate,
  type VisualWorkflowDefinition,
  type WorkflowActionKind,
} from "@/lib/cloud-workflows";
import { cn } from "@/lib/utils";

type FilterValue<T extends string> = T | "all";
type EditorTab = "editor" | "runs" | "settings";

const terminalStatuses = new Set<CloudRunStatus>(["succeeded", "failed", "stopped"]);
const defaultVisualWorkflow = (): VisualWorkflowDefinition => ({
  version: 1,
  trigger: { kind: "communication" },
  actions: ["review-account", "draft-email"],
  objective: "",
  stepConfig: {
    "action:0": { scope: "matching-record" },
    "action:1": { recipient: "promise-recipient", tone: "concise" },
  },
});

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function statusTone(status: string): string {
  switch (status) {
    case "succeeded":
    case "current":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
    case "running":
    case "syncing":
      return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "queued":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === "succeeded" || status === "current")
    return <CheckCircle className="size-4" weight="fill" />;
  if (status === "failed") return <XCircle className="size-4" weight="fill" />;
  if (status === "running" || status === "syncing")
    return <CircleNotch className="size-4 animate-spin" />;
  if (status === "queued") return <Clock className="size-4" />;
  return <Pause className="size-4" />;
}

function eventText(event: CloudRunEvent): string {
  if (typeof event.event === "string") return event.event;
  if (event.event && typeof event.event === "object") {
    const record = event.event as Record<string, unknown>;
    for (const key of ["message", "summary", "error", "content"]) {
      const value = record[key];
      if (typeof value === "string") return value;
    }
  }
  return JSON.stringify(event.event, null, 2) ?? String(event.event);
}

function scheduleLabel(task: CloudTask): string {
  const cron = taskCron(task);
  const labels: Record<string, string> = {
    "*/15 * * * *": "Every 15 minutes",
    "*/30 * * * *": "Every 30 minutes",
    "0 9 * * *": "Every day at 9:00 AM",
    "0 9 * * 1-5": "Weekdays at 9:00 AM",
    "0 8 * * *": "Every day at 8:00 AM",
    "0 8 * * 1": "Every Monday at 8:00 AM",
  };
  if (cron) return labels[cron] ?? "Recurring schedule";
  const visual = taskVisualWorkflow(task);
  switch (visual?.trigger.kind) {
    case "communication":
      return "When communication arrives";
    case "profile-change":
      return "When a profile is enriched";
    case "relationship-risk":
      return "When relationship risk changes";
    case "commitment-risk":
      return "When a commitment needs recovery";
    default:
      return "Manual start";
  }
}

function inferredManagedActions(task: CloudTask): WorkflowActionKind[] {
  if (task.slug.includes("post-meeting"))
    return ["review-account", "update-crm-note", "create-crm-task"];
  if (task.slug.includes("pre-brief")) return ["review-account", "write-brief"];
  if (task.slug.includes("recommendation")) return ["review-account", "create-crm-task"];
  if (task.slug.includes("connector")) return ["review-account", "write-brief"];
  return ["review-account", "write-brief"];
}

function workflowForTask(task: CloudTask): VisualWorkflowDefinition {
  const visual = taskVisualWorkflow(task);
  if (visual) return visual;
  return {
    version: 1,
    trigger: taskCron(task) ? { kind: "schedule", cronExpr: taskCron(task) } : { kind: "manual" },
    actions: inferredManagedActions(task),
    objective: `${task.name} keeps relationship intelligence current and surfaces the next evidence-backed action.`,
  };
}

function workflowStepCount(task: CloudTask): number {
  return workflowForTask(task).actions.length + 1;
}

function CreateWorkflowDialog({
  templates,
  onCreated,
}: {
  templates: CloudTaskTemplate[];
  onCreated: (task: CloudTask) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [objective, setObjective] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const definition = { ...defaultVisualWorkflow(), objective: objective.trim() };
      const compiled = compileVisualWorkflow(definition);
      const task = await createCloudTask({
        name: name.trim(),
        instructions: compiled.instructions,
        active: false,
        triggers: compiled.triggers,
      });
      onCreated(task);
      setOpen(false);
      setName("");
      setObjective("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create workflow");
    } finally {
      setBusy(false);
    }
  };

  const instantiate = async (template: CloudTaskTemplate) => {
    setBusy(true);
    setError(null);
    try {
      const task = await instantiateCloudTemplate(template.slug);
      onCreated(task);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="rounded-none" size="sm">
          <Plus className="size-4" /> New workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-none sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create workflow</DialogTitle>
          <DialogDescription>
            Start with a focused objective, then configure the trigger and actions on the canvas.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="custom">
          <TabsList className="w-full rounded-none" variant="line">
            <TabsTrigger value="custom">Start from scratch</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>
          <TabsContent className="space-y-4 pt-4" value="custom">
            <div className="space-y-1.5">
              <Label htmlFor="workflow-name">Workflow name</Label>
              <Input
                className="rounded-none"
                id="workflow-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Recover at-risk commitments"
                value={name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workflow-objective">What should happen?</Label>
              <Textarea
                className="min-h-28 rounded-none"
                id="workflow-objective"
                onChange={(event) => setObjective(event.target.value)}
                placeholder="When a customer promise is at risk, review the account and draft a concise recovery email for approval."
                value={objective}
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button
                className="rounded-none"
                disabled={busy || !name.trim() || !objective.trim()}
                onClick={create}
              >
                {busy ? <CircleNotch className="animate-spin" /> : <Cloud />} Create draft
              </Button>
            </DialogFooter>
          </TabsContent>
          <TabsContent className="pt-4" value="templates">
            <ScrollArea className="h-80 pr-3">
              <div className="divide-y divide-border border border-border">
                {templates
                  .filter((template) => !template.firstParty)
                  .map((template) => (
                    <div className="flex items-start justify-between gap-4 p-3" key={template.slug}>
                      <div>
                        <p className="text-[13px] font-medium">{template.name}</p>
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                          {template.description}
                        </p>
                      </div>
                      <Button
                        className="rounded-none"
                        disabled={busy}
                        onClick={() => void instantiate(template)}
                        size="sm"
                        variant="outline"
                      >
                        Use
                      </Button>
                    </div>
                  ))}
                {templates.filter((template) => !template.firstParty).length === 0 ? (
                  <p className="p-6 text-center text-xs text-muted-foreground">
                    No custom templates are available yet.
                  </p>
                ) : null}
              </div>
            </ScrollArea>
            {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowLibrary({
  tasks,
  runs,
  templates,
  busy,
  onCreated,
  onRefresh,
  onSelect,
}: {
  tasks: CloudTask[];
  runs: CloudRun[];
  templates: CloudTaskTemplate[];
  busy: boolean;
  onCreated: (task: CloudTask) => void;
  onRefresh: () => void;
  onSelect: (task: CloudTask) => void;
}) {
  const [query, setQuery] = React.useState("");
  const filtered = tasks.filter((task) =>
    `${task.name} ${scheduleLabel(task)}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <Button className="rounded-none" size="sm" variant="outline">
          Sorted by Last published
        </Button>
        <div className="flex items-center gap-2">
          <Button
            aria-label="Refresh workflows"
            className="rounded-none"
            disabled={busy}
            onClick={onRefresh}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowClockwise className={cn(busy && "animate-spin")} />
          </Button>
          <Button className="rounded-none" disabled size="sm" variant="outline">
            <SlidersHorizontal /> View settings
          </Button>
          <CreateWorkflowDialog onCreated={onCreated} templates={templates} />
        </div>
      </div>
      <div className="flex h-11 shrink-0 items-center border-b border-border px-3">
        <MagnifyingGlass className="mr-2 size-4 text-muted-foreground" />
        <Input
          aria-label="Search workflows"
          className="h-8 max-w-md rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search workflows"
          value={query}
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-[760px]">
          <div className="grid h-9 grid-cols-[minmax(260px,1.5fr)_minmax(190px,1fr)_110px_110px_150px_32px] items-center border-b border-border px-4 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            <span>Workflow</span>
            <span>Starts</span>
            <span>Steps</span>
            <span>Status</span>
            <span>Last run</span>
            <span />
          </div>
          {filtered.map((task) => {
            const lastRun = runs.find((run) => run.slug === task.slug);
            return (
              <button
                className="grid min-h-14 w-full grid-cols-[minmax(260px,1.5fr)_minmax(190px,1fr)_110px_110px_150px_32px] items-center border-b border-border px-4 text-left transition-colors hover:bg-muted/35"
                key={task.id}
                onClick={() => onSelect(task)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2 shrink-0",
                        task.active ? "bg-emerald-500" : "bg-muted-foreground/35",
                      )}
                    />
                    <span className="truncate text-[13px] font-medium">{task.name}</span>
                    {task.systemManaged ? (
                      <Badge className="rounded-none text-[9px]" variant="secondary">
                        Oppulence
                      </Badge>
                    ) : null}
                  </span>
                  <span className="ml-4.5 mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {taskVisualWorkflow(task)?.objective || "Always-on relationship intelligence"}
                  </span>
                </span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {scheduleLabel(task)}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {workflowStepCount(task)} steps
                </span>
                <span className="text-[12px]">{task.active ? "Live" : "Draft"}</span>
                <span className="text-[12px] text-muted-foreground">
                  {lastRun ? formatDate(lastRun.createdAt) : "Never"}
                </span>
                <CaretRight className="size-4 text-muted-foreground" />
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <Cloud className="size-8 text-muted-foreground" />
              <h2 className="mt-4 text-[15px] font-medium">No workflows found</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Try another search or create a workflow from scratch.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function RunInspector({
  run,
  events,
  busy,
  taskExecutionTarget,
  onCancel,
  onRetry,
}: {
  run: CloudRun | null;
  events: CloudRunEvent[];
  busy: boolean;
  taskExecutionTarget?: "api" | "desktop";
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (!run)
    return (
      <div className="flex min-h-48 items-center justify-center p-5 text-center text-sm text-muted-foreground">
        Select a run to inspect its status and transcript.
      </div>
    );
  return (
    <div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge className={cn("rounded-none", statusTone(run.status))} variant="outline">
              <StatusIcon status={run.status} /> {run.status}
            </Badge>
            <p className="mt-2 truncate font-mono text-xs text-muted-foreground" title={run.runId}>
              {run.runId}
            </p>
          </div>
          <div className="flex gap-2">
            {!terminalStatuses.has(run.status) &&
            run.executor === "api" &&
            Boolean(run.temporalWorkflowId) ? (
              <Button
                className="rounded-none"
                disabled={busy}
                onClick={onCancel}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
            ) : null}
            {(run.status === "failed" || run.status === "stopped") &&
            taskExecutionTarget === "api" ? (
              <Button className="rounded-none" disabled={busy} onClick={onRetry} size="sm">
                Retry
              </Button>
            ) : null}
          </div>
        </div>
        {run.progressPercent != null && !terminalStatuses.has(run.status) ? (
          <div className="space-y-1">
            <Progress value={run.progressPercent} />
            <p className="text-xs text-muted-foreground">
              {run.progressMessage || `${run.progressPercent}%`}
            </p>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Trigger</span>
            <p className="mt-0.5">{run.trigger}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Attempt</span>
            <p className="mt-0.5">{run.attempt}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Started</span>
            <p className="mt-0.5">{formatDate(run.startedAt || run.createdAt)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Completed</span>
            <p className="mt-0.5">{formatDate(run.completedAt)}</p>
          </div>
        </div>
        {run.summary ? (
          <p className="border border-border p-2.5 text-xs leading-5">{run.summary}</p>
        ) : null}
        {run.error ? (
          <p className="border border-destructive/30 bg-destructive/5 p-2.5 text-xs leading-5 text-destructive">
            {run.errorCode ? `${run.errorCode}: ` : ""}
            {run.error}
          </p>
        ) : null}
      </div>
      <Separator />
      <div className="p-4">
        <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Transcript
        </p>
        <ScrollArea className="h-64 pr-3">
          <ol className="space-y-3">
            {events.map((event) => (
              <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 text-xs" key={event.id}>
                <span className="flex size-7 items-center justify-center border border-border bg-background font-mono text-[10px]">
                  {event.seq}
                </span>
                <div className="min-w-0 border border-border p-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{event.type}</span>
                    <time className="text-muted-foreground">{formatDate(event.receivedAt)}</time>
                  </div>
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-sans leading-5 text-muted-foreground">
                    {eventText(event)}
                  </pre>
                </div>
              </li>
            ))}
            {events.length === 0 ? (
              <li className="text-muted-foreground">No transcript events yet.</li>
            ) : null}
          </ol>
        </ScrollArea>
      </div>
    </div>
  );
}

function WorkflowRuns({
  runs,
  selectedRun,
  events,
  busy,
  tasks,
  nextCursor,
  statusFilter,
  triggerFilter,
  executorFilter,
  onStatusFilter,
  onTriggerFilter,
  onExecutorFilter,
  onSelectRun,
  onLoadMore,
  onCancel,
  onRetry,
}: {
  runs: CloudRun[];
  selectedRun: CloudRun | null;
  events: CloudRunEvent[];
  busy: boolean;
  tasks: CloudTask[];
  nextCursor?: string;
  statusFilter: FilterValue<CloudRunStatus>;
  triggerFilter: FilterValue<CloudRunTrigger>;
  executorFilter: "api" | "desktop" | "all";
  onStatusFilter: (value: FilterValue<CloudRunStatus>) => void;
  onTriggerFilter: (value: FilterValue<CloudRunTrigger>) => void;
  onExecutorFilter: (value: "api" | "desktop" | "all") => void;
  onSelectRun: (run: CloudRun) => void;
  onLoadMore: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const selectedTask = tasks.find((task) => task.slug === selectedRun?.slug);
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(340px,0.8fr)_minmax(420px,1.2fr)]">
      <section className="flex min-h-0 flex-col border-r border-border">
        <div className="grid grid-cols-3 gap-2 border-b border-border p-3">
          <Select
            onValueChange={(value) => onStatusFilter(value as FilterValue<CloudRunStatus>)}
            value={statusFilter}
          >
            <SelectTrigger className="rounded-none" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="all">All status</SelectItem>
              {(["queued", "running", "succeeded", "failed", "stopped"] as const).map((value) => (
                <SelectItem className="rounded-none" key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) => onTriggerFilter(value as FilterValue<CloudRunTrigger>)}
            value={triggerFilter}
          >
            <SelectTrigger className="rounded-none" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="all">All triggers</SelectItem>
              {(["manual", "cron", "window", "event", "retry"] as const).map((value) => (
                <SelectItem className="rounded-none" key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) => onExecutorFilter(value as "api" | "desktop" | "all")}
            value={executorFilter}
          >
            <SelectTrigger className="rounded-none" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              <SelectItem value="all">All runtimes</SelectItem>
              <SelectItem value="api">Cloud</SelectItem>
              <SelectItem value="desktop">Desktop</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div>
            {runs.map((run) => (
              <button
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 border-b border-border px-3 text-left hover:bg-muted/35",
                  selectedRun?.runId === run.runId && "bg-muted/50",
                )}
                key={run.id}
                onClick={() => onSelectRun(run)}
                type="button"
              >
                <StatusIcon status={run.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">
                    {tasks.find((task) => task.slug === run.slug)?.name || run.slug}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {run.trigger} · {formatDate(run.createdAt)}
                  </span>
                </span>
                <CaretRight className="size-4 text-muted-foreground" />
              </button>
            ))}
            {runs.length === 0 ? (
              <p className="p-10 text-center text-xs text-muted-foreground">
                No runs match these filters.
              </p>
            ) : null}
            {nextCursor ? (
              <Button
                className="w-full rounded-none"
                onClick={onLoadMore}
                size="sm"
                variant="ghost"
              >
                Load more
              </Button>
            ) : null}
          </div>
        </ScrollArea>
      </section>
      <ScrollArea className="min-h-0">
        <RunInspector
          busy={busy}
          events={events}
          onCancel={onCancel}
          onRetry={onRetry}
          run={selectedRun}
          taskExecutionTarget={selectedTask?.executionTarget}
        />
      </ScrollArea>
    </div>
  );
}

function WorkflowEditor({
  task,
  schedule,
  runs,
  selectedRun,
  events,
  busy,
  onBack,
  onRun,
  onSelectRun,
  onCancel,
  onRetry,
  onUpdate,
}: {
  task: CloudTask;
  schedule: CloudSchedule | null;
  runs: CloudRun[];
  selectedRun: CloudRun | null;
  events: CloudRunEvent[];
  busy: boolean;
  onBack: () => void;
  onRun: () => void;
  onSelectRun: (run: CloudRun) => void;
  onCancel: () => void;
  onRetry: () => void;
  onUpdate: (patch: {
    active?: boolean;
    instructions?: string;
    name?: string;
    triggers?: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const editable = !task.systemManaged;
  const original = workflowForTask(task);
  const [tab, setTab] = React.useState<EditorTab>("editor");
  const [name, setName] = React.useState(task.name);
  const [workflow, setWorkflow] = React.useState(original);
  const dirty =
    editable &&
    (name.trim() !== task.name || JSON.stringify(workflow) !== JSON.stringify(original));
  const taskRuns = runs.filter((run) => run.slug === task.slug);

  const save = async () => {
    const compiled = compileVisualWorkflow(workflow);
    await onUpdate({
      name: name.trim(),
      instructions: compiled.instructions,
      triggers: compiled.triggers,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <Button className="rounded-none px-1.5" onClick={onBack} size="sm" variant="ghost">
            Workflows
          </Button>
          <CaretRight className="size-3 text-muted-foreground" />
          <span className="truncate font-medium">{task.name}</span>
          {task.systemManaged ? <Robot className="size-3.5 text-muted-foreground" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge className="rounded-none" variant={task.active ? "secondary" : "outline"}>
            {task.active ? "Live" : "Draft"}
          </Badge>
          <Switch
            aria-label="Workflow live status"
            checked={task.active}
            disabled={busy}
            onCheckedChange={(active) => void onUpdate({ active })}
            size="sm"
          />
          {editable ? (
            <Button
              className="rounded-none"
              disabled={!dirty || busy || !name.trim()}
              onClick={() => void save()}
              size="sm"
              variant="outline"
            >
              {busy ? <CircleNotch className="animate-spin" /> : null} Save
            </Button>
          ) : null}
          <Button
            className="rounded-none"
            disabled={busy || !task.active}
            onClick={onRun}
            size="sm"
          >
            <Play weight="fill" /> Run now
          </Button>
        </div>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-5 border-b border-border px-3">
        {(["editor", "runs", "settings"] as const).map((value) => (
          <button
            className={cn(
              "flex h-full items-center gap-1.5 border-b text-[12px] capitalize",
              tab === value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {value === "settings" ? <Gear className="size-3.5" /> : null}
            {value}
            {value === "runs" ? (
              <Badge className="rounded-none text-[9px]" variant="secondary">
                {taskRuns.length}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "editor" ? (
        <VisualWorkflowBuilder
          aria-label={`${task.name} workflow editor`}
          disabled={!editable}
          onChange={setWorkflow}
          value={workflow}
        />
      ) : tab === "runs" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
          <ScrollArea className="min-h-0 border-r border-border">
            {taskRuns.map((run) => (
              <button
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 border-b border-border px-3 text-left hover:bg-muted/35",
                  selectedRun?.runId === run.runId && "bg-muted/50",
                )}
                key={run.id}
                onClick={() => onSelectRun(run)}
                type="button"
              >
                <StatusIcon status={run.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium">{run.status}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {run.trigger} · {formatDate(run.createdAt)}
                  </span>
                </span>
                <CaretRight className="size-4 text-muted-foreground" />
              </button>
            ))}
            {taskRuns.length === 0 ? (
              <p className="p-8 text-center text-xs text-muted-foreground">No runs yet.</p>
            ) : null}
          </ScrollArea>
          <ScrollArea className="min-h-0">
            <RunInspector
              busy={busy}
              events={events}
              onCancel={onCancel}
              onRetry={onRetry}
              run={selectedRun}
              taskExecutionTarget={task.executionTarget}
            />
          </ScrollArea>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-2xl space-y-7 px-6 py-7">
            <div>
              <h2 className="text-[15px] font-medium">Workflow settings</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Keep the operational details simple. The cloud runtime handles scheduling and
                execution.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workflow-editor-name">Name</Label>
              <Input
                className="rounded-none"
                disabled={!editable}
                id="workflow-editor-name"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </div>
            <div className="grid grid-cols-2 border border-border">
              <div className="border-r border-border p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Starts
                </p>
                <p className="mt-2 text-[13px]">{scheduleLabel(task)}</p>
              </div>
              <div className="p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Next run
                </p>
                <p className="mt-2 text-[13px]">{formatDate(schedule?.nextDueAt)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between border-y border-border py-4">
              <div>
                <p className="text-[13px] font-medium">Run in Oppulence Cloud</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Runs continue even when the desktop app is closed.
                </p>
              </div>
              <Badge
                className={cn(
                  "rounded-none",
                  statusTone(schedule?.health || task.scheduleSyncState),
                )}
                variant="outline"
              >
                <StatusIcon status={schedule?.health || task.scheduleSyncState} />{" "}
                {schedule?.health || task.scheduleSyncState}
              </Badge>
            </div>
            {task.systemManaged ? (
              <p className="text-[11px] text-muted-foreground">
                This workflow is maintained by Oppulence. You can pause it, inspect it, and run it
                on demand.
              </p>
            ) : null}
            {editable ? (
              <div className="flex justify-end">
                <Button
                  className="rounded-none"
                  disabled={!dirty || busy || !name.trim()}
                  onClick={() => void save()}
                >
                  Save settings
                </Button>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export function CloudWorkflowsView({
  focus = "scheduled",
  initialRunId,
  initialSlug,
}: {
  focus?: "scheduled" | "runs";
  initialRunId?: string;
  initialSlug?: string;
}) {
  const [tasks, setTasks] = React.useState<CloudTask[]>([]);
  const [templates, setTemplates] = React.useState<CloudTaskTemplate[]>([]);
  const [runs, setRuns] = React.useState<CloudRun[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string>();
  const [selectedSlug, setSelectedSlug] = React.useState(initialSlug || "");
  const [selectedRun, setSelectedRun] = React.useState<CloudRun | null>(null);
  const [events, setEvents] = React.useState<CloudRunEvent[]>([]);
  const [schedule, setSchedule] = React.useState<CloudSchedule | null>(null);
  const [screen, setScreen] = React.useState<"library" | "editor" | "runs">(
    initialSlug ? "editor" : focus === "runs" ? "runs" : "library",
  );
  const [statusFilter, setStatusFilter] = React.useState<FilterValue<CloudRunStatus>>("all");
  const [triggerFilter, setTriggerFilter] = React.useState<FilterValue<CloudRunTrigger>>("all");
  const [executorFilter, setExecutorFilter] = React.useState<"api" | "desktop" | "all">("all");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const selectedTask = tasks.find((task) => task.slug === selectedSlug);
  const selectedTaskSlug = selectedTask?.slug;
  const selectedTaskRevision = selectedTask?.revision;
  const selectedRunID = selectedRun?.runId;
  const selectedRunSlug = selectedRun?.slug;
  const selectedRunStatus = selectedRun?.status;

  const selectRun = React.useCallback((run: CloudRun | null) => {
    setSelectedRun(run);
    setEvents([]);
    if (run) setSelectedSlug(run.slug);
  }, []);

  const loadRuns = React.useCallback(
    async (cursor?: string, append = false) => {
      const result = await listCloudRuns({
        status: statusFilter,
        trigger: triggerFilter,
        executor: executorFilter,
        cursor,
      });
      setRuns((current) =>
        append
          ? [...new Map([...current, ...result.runs].map((run) => [run.id, run])).values()]
          : result.runs,
      );
      setSelectedRun((current) => {
        if (!current)
          return initialRunId
            ? result.runs.find((run) => run.runId === initialRunId) || null
            : null;
        return result.runs.find((run) => run.runId === current.runId) || current;
      });
      setNextCursor(result.nextCursor);
    },
    [executorFilter, initialRunId, statusFilter, triggerFilter],
  );

  const loadDefinitions = React.useCallback(async () => {
    setError(null);
    try {
      await ensureFirstPartyWorkflows();
      const [nextTasks, nextTemplates] = await Promise.all([
        listCloudTasks(),
        listCloudTemplates(),
      ]);
      setTasks(nextTasks);
      setTemplates(nextTemplates);
      setSelectedSlug((current) => current || nextTasks[0]?.slug || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = React.useCallback(async () => {
    await Promise.all([loadDefinitions(), loadRuns()]);
  }, [loadDefinitions, loadRuns]);

  React.useEffect(() => {
    queueMicrotask(() => void loadDefinitions());
  }, [loadDefinitions]);

  React.useEffect(() => {
    queueMicrotask(
      () =>
        void loadRuns().catch((cause) =>
          setError(cause instanceof Error ? cause.message : "Could not load workflow runs"),
        ),
    );
  }, [loadRuns]);

  React.useEffect(() => {
    if (!initialSlug || !initialRunId) return;
    let cancelled = false;
    void getCloudRun(initialSlug, initialRunId)
      .then((run) => {
        if (!cancelled) selectRun(run);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load workflow run");
      });
    return () => {
      cancelled = true;
    };
  }, [initialRunId, initialSlug, selectRun]);

  React.useEffect(() => {
    if (!selectedTaskSlug || screen !== "editor") return;
    let cancelled = false;
    void getCloudSchedule(selectedTaskSlug)
      .then((value) => {
        if (!cancelled) setSchedule(value);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load schedule");
      });
    return () => {
      cancelled = true;
    };
  }, [screen, selectedTaskRevision, selectedTaskSlug]);

  React.useEffect(() => {
    if (!selectedRunID || !selectedRunSlug || !selectedRunStatus) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [nextEvents, nextRun] = await Promise.all([
          listCloudRunEvents(selectedRunSlug, selectedRunID),
          getCloudRun(selectedRunSlug, selectedRunID),
        ]);
        if (!cancelled) {
          setEvents(nextEvents);
          setSelectedRun(nextRun);
        }
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not refresh workflow run");
      }
    };
    void load();
    if (terminalStatuses.has(selectedRunStatus))
      return () => {
        cancelled = true;
      };
    const timer = window.setInterval(() => {
      void load();
      void loadRuns();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadRuns, selectedRunID, selectedRunSlug, selectedRunStatus]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow operation failed");
    } finally {
      setBusy(false);
    }
  };

  const replaceTask = (task: CloudTask) => {
    setTasks((current) =>
      [...current.filter((item) => item.id !== task.id), task].sort(
        (a, b) => Number(b.systemManaged) - Number(a.systemManaged) || a.name.localeCompare(b.name),
      ),
    );
    setSelectedSlug(task.slug);
  };

  if (loading)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <CircleNotch className="size-4 animate-spin" /> Loading workflows
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-[13px]">
      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <Warning className="size-4" /> {error}
        </div>
      ) : null}

      {screen === "library" ? (
        <WorkflowLibrary
          busy={busy}
          onCreated={(task) => {
            replaceTask(task);
            setSchedule(null);
            setScreen("editor");
          }}
          onRefresh={() => void refresh()}
          onSelect={(task) => {
            setSelectedSlug(task.slug);
            selectRun(null);
            setSchedule(null);
            setScreen("editor");
          }}
          runs={runs}
          tasks={tasks}
          templates={templates}
        />
      ) : screen === "runs" ? (
        <WorkflowRuns
          busy={busy}
          events={events}
          executorFilter={executorFilter}
          nextCursor={nextCursor}
          onCancel={() =>
            selectedRun &&
            void perform(async () => {
              selectRun(await cancelCloudRun(selectedRun));
              await loadRuns();
            })
          }
          onExecutorFilter={setExecutorFilter}
          onLoadMore={() => nextCursor && void loadRuns(nextCursor, true)}
          onRetry={() =>
            selectedRun &&
            void perform(async () => {
              selectRun(await retryCloudRun(selectedRun));
              await loadRuns();
            })
          }
          onSelectRun={selectRun}
          onStatusFilter={setStatusFilter}
          onTriggerFilter={setTriggerFilter}
          runs={runs}
          selectedRun={selectedRun}
          statusFilter={statusFilter}
          tasks={tasks}
          triggerFilter={triggerFilter}
        />
      ) : selectedTask ? (
        <WorkflowEditor
          busy={busy}
          events={events}
          key={`${selectedTask.id}:${selectedTask.revision}`}
          onBack={() => {
            selectRun(null);
            setScreen("library");
          }}
          onCancel={() =>
            selectedRun &&
            void perform(async () => {
              selectRun(await cancelCloudRun(selectedRun));
              await loadRuns();
            })
          }
          onRetry={() =>
            selectedRun &&
            void perform(async () => {
              selectRun(await retryCloudRun(selectedRun));
              await loadRuns();
            })
          }
          onRun={() =>
            void perform(async () => {
              const run = await triggerCloudRun(
                selectedTask.slug,
                "Started from the visual workflow editor.",
              );
              selectRun(run);
              await loadRuns();
            })
          }
          onSelectRun={selectRun}
          onUpdate={(patch) =>
            perform(async () => {
              replaceTask(await updateCloudTask(selectedTask, patch));
            })
          }
          runs={runs}
          schedule={schedule}
          selectedRun={selectedRun}
          task={selectedTask}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No workflow selected.
        </div>
      )}
    </div>
  );
}
