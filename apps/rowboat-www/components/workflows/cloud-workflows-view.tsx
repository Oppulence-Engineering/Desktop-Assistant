"use client";

import * as React from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  CheckCircle,
  CircleNotch,
  Clock,
  Cloud,
  Pause,
  Play,
  Plus,
  Robot,
  Warning,
  XCircle,
} from "@phosphor-icons/react";

import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@oppulence/ui/components/card";
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

import {
  cancelCloudRun,
  createCloudTask,
  ensureFirstPartyWorkflows,
  getCloudSchedule,
  getCloudRun,
  instantiateCloudTemplate,
  listCloudRunEvents,
  listCloudRuns,
  listCloudTasks,
  listCloudTemplates,
  retryCloudRun,
  taskCron,
  triggerCloudRun,
  updateCloudTask,
  type CloudRun,
  type CloudRunEvent,
  type CloudRunStatus,
  type CloudRunTrigger,
  type CloudSchedule,
  type CloudTask,
  type CloudTaskTemplate,
} from "@/lib/cloud-workflows";
import { cn } from "@/lib/utils";

type FilterValue<T extends string> = T | "all";

const terminalStatuses = new Set<CloudRunStatus>(["succeeded", "failed", "stopped"]);

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
      if (typeof record[key] === "string") return record[key];
    }
  }
  return JSON.stringify(event.event, null, 2);
}

function WorkflowTaskList({
  tasks,
  selectedSlug,
  onSelect,
}: {
  tasks: CloudTask[];
  selectedSlug?: string;
  onSelect: (task: CloudTask) => void;
}) {
  const firstParty = tasks.filter((task) => task.systemManaged);
  const custom = tasks.filter((task) => !task.systemManaged);
  const group = (label: string, rows: CloudTask[]) => (
    <div className="space-y-1.5" key={label}>
      <div className="flex items-center justify-between px-2 pt-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {rows.map((task) => (
        <Button
          className={cn(
            "h-auto w-full justify-start rounded-lg px-2.5 py-2.5 text-left",
            selectedSlug === task.slug && "bg-muted",
          )}
          key={task.id}
          onClick={() => onSelect(task)}
          variant="ghost"
        >
          <span
            className={cn(
              "mt-0.5 size-2 shrink-0 rounded-full",
              task.active ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{task.name}</span>
            <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
              {taskCron(task) || "Manual"}
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
  return (
    <ScrollArea className="min-h-0 flex-1 px-1">
      <div className="space-y-3 pb-4">
        {group("Oppulence workflows", firstParty)}
        {custom.length ? group("Custom workflows", custom) : null}
      </div>
    </ScrollArea>
  );
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
  const [instructions, setInstructions] = React.useState("");
  const [cron, setCron] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const task = await createCloudTask({
        name,
        instructions,
        active: true,
        cronExpr: cron.trim() || undefined,
      });
      onCreated(task);
      setOpen(false);
      setName("");
      setInstructions("");
      setCron("");
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
        <Button className="rounded-full" size="sm">
          <Plus className="size-4" /> New workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a cloud workflow</DialogTitle>
          <DialogDescription>
            Run on Oppulence even when the desktop app is closed.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="custom">
          <TabsList className="w-full" variant="line">
            <TabsTrigger value="custom">Custom</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>
          <TabsContent className="space-y-4 pt-3" value="custom">
            <div className="space-y-2">
              <Label htmlFor="workflow-name">Name</Label>
              <Input
                id="workflow-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="Renewal risk review"
                value={name}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workflow-instructions">Instructions</Label>
              <Textarea
                id="workflow-instructions"
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Explain what evidence to inspect and what artifact to produce."
                rows={6}
                value={instructions}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workflow-cron">
                Cron schedule <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                className="font-mono"
                id="workflow-cron"
                onChange={(event) => setCron(event.target.value)}
                placeholder="0 9 * * 1-5"
                value={cron}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button disabled={busy || !name.trim() || !instructions.trim()} onClick={create}>
                {busy ? (
                  <CircleNotch className="size-4 animate-spin" />
                ) : (
                  <Cloud className="size-4" />
                )}{" "}
                Create
              </Button>
            </DialogFooter>
          </TabsContent>
          <TabsContent className="pt-3" value="templates">
            <ScrollArea className="h-80 pr-3">
              <div className="space-y-2">
                {templates
                  .filter((template) => !template.firstParty)
                  .map((template) => (
                    <Card key={template.slug}>
                      <CardHeader className="gap-1 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <CardTitle className="text-sm">{template.name}</CardTitle>
                            <CardDescription className="mt-1 text-xs">
                              {template.description}
                            </CardDescription>
                          </div>
                          <Button
                            disabled={busy}
                            onClick={() => instantiate(template)}
                            size="sm"
                            variant="outline"
                          >
                            Add
                          </Button>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function TaskInspector({
  task,
  schedule,
  busy,
  onRun,
  onUpdate,
}: {
  task: CloudTask;
  schedule: CloudSchedule | null;
  busy: boolean;
  onRun: () => void;
  onUpdate: (patch: {
    active?: boolean;
    cronExpr?: string;
    instructions?: string;
  }) => Promise<void>;
}) {
  const [cron, setCron] = React.useState(taskCron(task));
  const [instructions, setInstructions] = React.useState(task.instructions);
  const editable = !task.systemManaged;
  const dirty = editable && (cron !== taskCron(task) || instructions !== task.instructions);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {task.systemManaged ? (
                <Badge variant="secondary">
                  <Robot className="size-3" /> Oppulence managed
                </Badge>
              ) : null}
              <Badge className={statusTone(task.scheduleSyncState)} variant="outline">
                {task.scheduleSyncState}
              </Badge>
            </div>
            <h2 className="text-2xl font-medium tracking-[-0.15px]">{task.name}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{task.slug}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border px-3 py-1.5">
              <span className="text-xs text-muted-foreground">Active</span>
              <Switch
                checked={task.active}
                disabled={busy}
                onCheckedChange={(active) => void onUpdate({ active })}
                size="sm"
              />
            </div>
            <Button className="rounded-full" disabled={busy || !task.active} onClick={onRun}>
              {busy ? (
                <CircleNotch className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" weight="fill" />
              )}{" "}
              Run now
            </Button>
          </div>
        </div>

        {schedule ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="p-4">
                <CardDescription>Schedule health</CardDescription>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <StatusIcon status={schedule.health} /> {schedule.health}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="p-4">
                <CardDescription>Mechanism</CardDescription>
                <CardTitle className="text-sm">{schedule.mechanism.replaceAll("_", " ")}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="p-4">
                <CardDescription>Next run</CardDescription>
                <CardTitle className="text-sm">{formatDate(schedule.nextDueAt)}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        ) : null}

        <Separator />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <Label htmlFor="task-instructions">Instructions</Label>
            <Textarea
              disabled={!editable}
              id="task-instructions"
              onChange={(event) => setInstructions(event.target.value)}
              rows={10}
              value={instructions}
            />
            {task.systemManaged ? (
              <p className="text-xs text-muted-foreground">
                Version {task.templateVersion} is maintained by Oppulence. You can pause it without
                losing its definition.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-cron">Cron schedule</Label>
            <Input
              className="font-mono"
              disabled={!editable}
              id="task-cron"
              onChange={(event) => setCron(event.target.value)}
              value={cron}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Times use the workflow timezone. Empty schedules remain manual.
            </p>
          </div>
        </div>
        {editable ? (
          <div className="flex justify-end">
            <Button
              disabled={!dirty || busy}
              onClick={() => void onUpdate({ cronExpr: cron, instructions })}
              variant="outline"
            >
              Save definition
            </Button>
          </div>
        ) : null}

        <Separator />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Last run</p>
            <p className="mt-1 text-sm">{formatDate(task.lastRunAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Execution</p>
            <p className="mt-1 text-sm uppercase">{task.executionTarget}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Trigger sources</p>
            <p className="mt-1 text-sm">{schedule?.triggerSources.join(", ") || "Manual"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Definition updated</p>
            <p className="mt-1 text-sm">{formatDate(task.updatedAt)}</p>
          </div>
        </div>
        {task.lastRunSummary ? (
          <Card>
            <CardHeader className="p-4">
              <CardDescription>Latest summary</CardDescription>
              <CardTitle className="text-sm font-normal leading-6">{task.lastRunSummary}</CardTitle>
            </CardHeader>
          </Card>
        ) : null}
        {task.scheduleSyncError || task.lastRunError ? (
          <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <Warning className="mt-0.5 size-4 shrink-0" />
            {task.scheduleSyncError || task.lastRunError}
          </div>
        ) : null}
      </div>
    </ScrollArea>
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
    <div className="border-t">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge className={statusTone(run.status)} variant="outline">
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
              <Button disabled={busy} onClick={onCancel} size="sm" variant="outline">
                Cancel
              </Button>
            ) : null}
            {(run.status === "failed" || run.status === "stopped") &&
            taskExecutionTarget === "api" ? (
              <Button disabled={busy} onClick={onRetry} size="sm">
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
          <p className="rounded-md bg-muted p-2.5 text-xs leading-5">{run.summary}</p>
        ) : null}
        {run.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs leading-5 text-destructive">
            {run.errorCode ? `${run.errorCode}: ` : ""}
            {run.error}
          </p>
        ) : null}
      </div>
      <Separator />
      <div className="p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Transcript
        </p>
        <ScrollArea className="h-64 pr-3">
          <ol className="space-y-3">
            {events.map((event) => (
              <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 text-xs" key={event.id}>
                <span className="flex size-7 items-center justify-center rounded-full border bg-background font-mono text-[10px]">
                  {event.seq}
                </span>
                <div className="min-w-0 rounded-md border p-2.5">
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

export function CloudWorkflowsView({
  initialRunId,
  initialSlug,
}: {
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
  const [statusFilter, setStatusFilter] = React.useState<FilterValue<CloudRunStatus>>("all");
  const [triggerFilter, setTriggerFilter] = React.useState<FilterValue<CloudRunTrigger>>("all");
  const [executorFilter, setExecutorFilter] = React.useState<"api" | "desktop" | "all">("all");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const selectedTask = tasks.find((task) => task.slug === selectedSlug) || tasks[0];
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
      setRuns((current) => {
        if (!append) return result.runs;
        return [...new Map([...current, ...result.runs].map((run) => [run.id, run])).values()];
      });
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
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadDefinitions();
    });
    return () => {
      cancelled = true;
    };
  }, [loadDefinitions]);

  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void loadRuns().catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load workflow runs");
      });
    });
    return () => {
      cancelled = true;
    };
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
    if (!selectedTaskSlug) return;
    let cancelled = false;
    getCloudSchedule(selectedTaskSlug)
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
  }, [selectedTaskRevision, selectedTaskSlug]);

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
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not refresh workflow run");
        }
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
        <CircleNotch className="size-4 animate-spin" /> Loading cloud workflows
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Cloud className="size-5 text-oppulence-orange" weight="fill" />
            <h1 className="text-sm font-medium">Cloud workflows</h1>
            <Badge variant="secondary">{tasks.filter((task) => task.active).length} active</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Always-on relationship intelligence with durable schedules, transcripts, retries, and
            control.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={() => void refresh()} size="sm" variant="outline">
            <ArrowClockwise className={cn("size-4", busy && "animate-spin")} /> Refresh
          </Button>
          <CreateWorkflowDialog
            onCreated={(task) => {
              replaceTask(task);
              void loadRuns();
            }}
            templates={templates}
          />
        </div>
      </div>
      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          <Warning className="size-4" />
          {error}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[260px_minmax(520px,1fr)_390px]">
        <aside className="flex min-h-0 flex-col border-r bg-muted/10">
          <WorkflowTaskList
            onSelect={(task) => {
              setSelectedSlug(task.slug);
              selectRun(null);
              setSchedule(null);
            }}
            selectedSlug={selectedTask?.slug}
            tasks={tasks}
          />
        </aside>
        <section className="flex min-h-0 flex-col border-r">
          {selectedTask ? (
            <TaskInspector
              key={`${selectedTask.id}:${selectedTask.revision}`}
              busy={busy}
              onRun={() =>
                void perform(async () => {
                  const run = await triggerCloudRun(
                    selectedTask.slug,
                    "Started from the web workflow console.",
                  );
                  selectRun(run);
                  await loadRuns();
                })
              }
              onUpdate={(patch) =>
                perform(async () => {
                  replaceTask(await updateCloudTask(selectedTask, patch));
                })
              }
              schedule={schedule}
              task={selectedTask}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No workflows are provisioned.
            </div>
          )}
        </section>
        <aside className="flex min-h-0 flex-col bg-muted/5">
          <div className="border-b p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarBlank className="size-4" />
                <p className="text-sm font-medium">Cloud Runs</p>
              </div>
              <span className="text-xs text-muted-foreground">{runs.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Select
                onValueChange={(value) => setStatusFilter(value as FilterValue<CloudRunStatus>)}
                value={statusFilter}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  {["queued", "running", "succeeded", "failed", "stopped"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                onValueChange={(value) => setTriggerFilter(value as FilterValue<CloudRunTrigger>)}
                value={triggerFilter}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All triggers</SelectItem>
                  {["manual", "cron", "window", "event", "retry"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                onValueChange={(value) => setExecutorFilter(value as "api" | "desktop" | "all")}
                value={executorFilter}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All runtimes</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                  <SelectItem value="desktop">Desktop</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ScrollArea className="max-h-[42%] min-h-52 border-b">
            <div className="space-y-1 p-2">
              {runs.map((run) => (
                <Button
                  className={cn(
                    "h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left",
                    selectedRun?.runId === run.runId && "bg-muted",
                  )}
                  key={run.id}
                  onClick={() => selectRun(run)}
                  variant="ghost"
                >
                  <StatusIcon status={run.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {tasks.find((task) => task.slug === run.slug)?.name || run.slug}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      {run.trigger} · {formatDate(run.createdAt)}
                    </span>
                  </span>
                </Button>
              ))}
              {runs.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No runs match these filters.
                </div>
              ) : null}
              {nextCursor ? (
                <Button
                  className="w-full"
                  onClick={() => void loadRuns(nextCursor, true)}
                  size="sm"
                  variant="ghost"
                >
                  Load more
                </Button>
              ) : null}
            </div>
          </ScrollArea>
          <ScrollArea className="min-h-0 flex-1">
            <RunInspector
              busy={busy}
              events={events}
              onCancel={() =>
                selectedRun &&
                void perform(async () => {
                  const run = await cancelCloudRun(selectedRun);
                  selectRun(run);
                  await loadRuns();
                })
              }
              onRetry={() =>
                selectedRun &&
                void perform(async () => {
                  const run = await retryCloudRun(selectedRun);
                  selectRun(run);
                  await loadRuns();
                })
              }
              run={selectedRun}
              taskExecutionTarget={selectedTask?.executionTarget}
            />
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
