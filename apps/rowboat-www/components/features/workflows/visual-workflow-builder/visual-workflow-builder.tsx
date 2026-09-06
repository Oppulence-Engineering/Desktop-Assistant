"use client";

import "client-only";

import * as React from "react";
import type { ComponentPropsWithoutRef } from "react";
import { ArrowRight, Plus, Trash } from "@phosphor-icons/react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";

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
import { cn } from "@oppulence/ui/lib/utils";
import type {
  VisualWorkflowDefinition,
  WorkflowActionKind,
  WorkflowTriggerKind,
} from "@/lib/cloud-workflows";

const triggers: Array<{ value: WorkflowTriggerKind; label: string; detail: string }> = [
  { value: "manual", label: "Manual start", detail: "Run on demand" },
  { value: "schedule", label: "Schedule", detail: "Cron schedule" },
  {
    value: "communication",
    label: "Communication received",
    detail: "Gmail, Calendar, Slack, or HubSpot",
  },
  {
    value: "profile-change",
    label: "Profile data changes",
    detail: "Checks cited enrichment every 15 minutes",
  },
  {
    value: "relationship-risk",
    label: "Relationship risk changes",
    detail: "New or changed attention signal",
  },
  {
    value: "commitment-risk",
    label: "Commitment needs recovery",
    detail: "Due, overdue, disputed, or blocked",
  },
];

const actions: Array<{ value: WorkflowActionKind; label: string; detail: string }> = [
  {
    value: "review-account",
    label: "Review account",
    detail: "Read relationships, people, promises, and evidence",
  },
  {
    value: "draft-email",
    label: "Draft recovery email",
    detail: "Create a Gmail draft; never auto-send",
  },
  {
    value: "create-crm-task",
    label: "Create CRM task",
    detail: "Write an owned, dated HubSpot task",
  },
  {
    value: "update-crm-note",
    label: "Update CRM note",
    detail: "Append an evidence-linked HubSpot note",
  },
  { value: "schedule-meeting", label: "Schedule meeting", detail: "Approval-gated calendar write" },
  { value: "write-brief", label: "Publish live brief", detail: "Save a durable workflow artifact" },
];

const labelFor = (value: WorkflowTriggerKind | WorkflowActionKind) =>
  [...triggers, ...actions].find((item) => item.value === value)?.label ?? value;

const nodeStyle = {
  backgroundColor: "var(--background)",
  border: "1px solid var(--border)",
  borderRadius: 0,
  color: "var(--primary)",
  width: 210,
};

function graph(definition: VisualWorkflowDefinition): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "trigger",
      position: { x: 24, y: 72 },
      data: { label: `WHEN  ${labelFor(definition.trigger.kind)}` },
      style: nodeStyle,
    },
    ...definition.actions.map((action, index) => ({
      id: `action:${index}`,
      position: { x: 284 + index * 244, y: 72 },
      data: { label: `${index + 1}. ${labelFor(action)}` },
      style: nodeStyle,
    })),
  ];
  return {
    nodes,
    edges: definition.actions.map((_, index) => ({
      id: `edge:${index}`,
      source: index === 0 ? "trigger" : `action:${index - 1}`,
      target: `action:${index}`,
      markerEnd: { type: MarkerType.ArrowClosed },
    })),
  };
}

export type VisualWorkflowBuilderProps = Omit<ComponentPropsWithoutRef<"section">, "onChange"> & {
  value: VisualWorkflowDefinition;
  onChange: (value: VisualWorkflowDefinition) => void;
  disabled?: boolean;
};

export function VisualWorkflowBuilder({
  className,
  value,
  onChange,
  disabled = false,
  ...props
}: VisualWorkflowBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(graph(value).nodes);
  const [edges, setEdges] = useEdgesState(graph(value).edges);
  const [nextAction, setNextAction] = React.useState<WorkflowActionKind>("draft-email");

  React.useEffect(() => {
    const next = graph(value);
    setNodes((current) =>
      next.nodes.map((node) => ({
        ...node,
        position: current.find((item) => item.id === node.id)?.position ?? node.position,
      })),
    );
    setEdges(next.edges);
  }, [setEdges, setNodes, value]);

  return (
    <section
      data-slot="visual-workflow-builder"
      className={cn("border border-border bg-background", className)}
      {...props}
    >
      <div className="grid gap-3 border-b border-border p-3 md:grid-cols-[minmax(220px,1fr)_minmax(260px,1fr)_auto] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="workflow-trigger">When</Label>
          <Select
            disabled={disabled}
            value={value.trigger.kind}
            onValueChange={(kind: WorkflowTriggerKind) =>
              onChange({ ...value, trigger: { ...value.trigger, kind } })
            }
          >
            <SelectTrigger id="workflow-trigger" className="rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {triggers.map((trigger) => (
                <SelectItem className="rounded-none" key={trigger.value} value={trigger.value}>
                  {trigger.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workflow-action">Then</Label>
          <Select
            disabled={disabled}
            value={nextAction}
            onValueChange={(action: WorkflowActionKind) => setNextAction(action)}
          >
            <SelectTrigger id="workflow-action" className="rounded-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {actions.map((action) => (
                <SelectItem className="rounded-none" key={action.value} value={action.value}>
                  {action.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          className="rounded-none"
          disabled={disabled || value.actions.includes(nextAction)}
          onClick={() => onChange({ ...value, actions: [...value.actions, nextAction] })}
          type="button"
          variant="outline"
        >
          <Plus /> Add step
        </Button>
      </div>

      {value.trigger.kind === "schedule" ? (
        <div className="grid gap-1.5 border-b border-border p-3">
          <Label htmlFor="visual-workflow-cron">Cron schedule</Label>
          <Input
            className="rounded-none font-mono"
            disabled={disabled}
            id="visual-workflow-cron"
            onChange={(event) =>
              onChange({ ...value, trigger: { ...value.trigger, cronExpr: event.target.value } })
            }
            placeholder="0 9 * * 1-5"
            value={value.trigger.cronExpr ?? ""}
          />
        </div>
      ) : null}
      {value.trigger.kind === "communication" ? (
        <div className="grid gap-1.5 border-b border-border p-3">
          <Label htmlFor="visual-workflow-criteria">Which communication should match?</Label>
          <Input
            className="rounded-none"
            disabled={disabled}
            id="visual-workflow-criteria"
            onChange={(event) =>
              onChange({ ...value, trigger: { ...value.trigger, criteria: event.target.value } })
            }
            placeholder="For example: messages from customers that mention a blocker or deadline"
            value={value.trigger.criteria ?? ""}
          />
        </div>
      ) : null}

      <div className="h-64 border-b border-border bg-background-100/30" aria-label="Workflow graph">
        <ReactFlow
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodes={nodes}
          nodesConnectable={false}
          onNodesChange={onNodesChange}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} />
          <Controls
            className="!rounded-none !border !border-border !bg-background !shadow-none [&>button]:!rounded-none [&>button]:!border-border [&>button]:!bg-background [&>button]:!fill-primary"
            showInteractive={false}
          />
        </ReactFlow>
      </div>

      <ol className="divide-y divide-border">
        {value.actions.map((action, index) => (
          <li className="flex items-center gap-3 px-3 py-2" key={action}>
            <Badge className="rounded-none" variant="outline">
              {index + 1}
            </Badge>
            <ArrowRight className="size-3.5 text-primary/30" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-primary">{labelFor(action)}</p>
              <p className="truncate text-[11px] text-primary/45">
                {actions.find((item) => item.value === action)?.detail}
              </p>
            </div>
            <Button
              aria-label={`Remove ${labelFor(action)}`}
              className="rounded-none"
              disabled={disabled || value.actions.length === 1}
              onClick={() =>
                onChange({ ...value, actions: value.actions.filter((_, item) => item !== index) })
              }
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash />
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
