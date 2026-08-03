"use client";

import * as React from "react";
import {
  createRelationshipGraphSavedView,
  queryRelationshipGraph,
  relationshipGraphNeighborhood,
} from "@oppulence/relationship-contract";
import {
  ArrowCounterClockwise,
  Buildings,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  FileText,
  FlagBanner,
  FloppyDisk,
  Graph,
  Handshake,
  Link,
  ListBullets,
  Note,
  PaperPlaneTilt,
  PlugsConnected,
  ShareNetwork,
  ShieldCheck,
  Sparkle,
  UserCircle,
  WarningDiamond,
  X,
} from "@phosphor-icons/react";
import {
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { errMessage } from "@/components/revenue/shared";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import { DateTimePicker } from "@oppulence/ui/components/date-time-picker";
import { Input } from "@oppulence/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";
import { Slider } from "@oppulence/ui/components/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@oppulence/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@oppulence/ui/components/toggle-group";
import {
  approveAction,
  createAction,
  evaluateAction,
  getRelationshipGraph,
  rejectAction,
} from "@/lib/revenue";
import {
  RelationshipGraphSavedViewSchema,
  RelationshipGraphSavedViewsSchema,
  type RelationshipGraph,
  type RelationshipGraphEdge,
  type RelationshipGraphNode,
  type RelationshipGraphSavedView,
  type RelationshipGraphSavedViewState,
  type RevenueRelationship,
} from "@/types/revenue";

const SAVED_VIEWS_KEY = "oppulence.relationship-graph.saved-views.v1";
const GRAPH_CAPABILITIES =
  "relationship-graph graph-query graph-saved-views graph-governed-actions";

const DEFAULT_STATE: RelationshipGraphSavedViewState = {
  scope: "portfolio",
  query: "",
  layout: "force",
  density: 0.72,
  hideIsolated: false,
  focusDepth: 0,
  changedSinceReview: false,
};

const KIND_ORDER: RelationshipGraphNode["kind"][] = [
  "relationship",
  "person",
  "commitment",
  "risk",
  "milestone",
  "action",
  "evidence",
  "source",
  "note",
];

const KIND_LABEL: Record<RelationshipGraphNode["kind"], string> = {
  relationship: "Account",
  person: "Person",
  commitment: "Commitment",
  risk: "Risk",
  milestone: "Milestone",
  action: "Action",
  evidence: "Evidence",
  source: "Source",
  note: "Note",
};

const NODE_RING: Record<string, string> = {
  healthy: "border-emerald-500/70 shadow-[0_0_0_2px_rgba(16,185,129,0.12)]",
  needs_attention: "border-amber-500/75 shadow-[0_0_0_2px_rgba(245,158,11,0.14)]",
  critical: "border-red-500/80 shadow-[0_0_0_2px_rgba(239,68,68,0.16)]",
  current: "border-cyan-500/60",
  aging: "border-amber-500/60",
  stale: "border-red-500/65",
  approved: "border-emerald-500/60",
  rejected: "border-red-500/60",
  pending: "border-amber-500/60",
};

const nodeTone = (node: RelationshipGraphNode) =>
  NODE_RING[node.health || node.freshness || node.approvalStatus || ""] || "border-border";

const nodeShape = (kind: RelationshipGraphNode["kind"]) => {
  if (kind === "person") return "rounded-full";
  if (kind === "risk") return "rounded-none";
  if (kind === "milestone") return "rounded-lg";
  if (kind === "source") return "rounded-xl";
  return "rounded-[2px]";
};

const NodeIcon = ({
  kind,
  className = "size-4",
}: {
  kind: RelationshipGraphNode["kind"];
  className?: string;
}) => {
  const props = { className, weight: "duotone" as const, "aria-hidden": true };
  switch (kind) {
    case "relationship":
      return <Buildings {...props} />;
    case "person":
      return <UserCircle {...props} />;
    case "commitment":
      return <Handshake {...props} />;
    case "risk":
      return <WarningDiamond {...props} />;
    case "milestone":
      return <FlagBanner {...props} />;
    case "action":
      return <PaperPlaneTilt {...props} />;
    case "evidence":
      return <FileText {...props} />;
    case "source":
      return <PlugsConnected {...props} />;
    default:
      return <Note {...props} />;
  }
};

type GraphNodeData = { graphNode: RelationshipGraphNode };
type FlowNode = Node<GraphNodeData, "relationshipNode">;
type FlowEdge = Edge<{ graphEdge: RelationshipGraphEdge }, "typedEdge">;

function GraphNodeCard({ data, selected }: NodeProps<FlowNode>) {
  const node = data.graphNode;
  const badges = [
    node.health,
    node.approvalStatus,
    node.freshness,
    node.confidence === undefined ? undefined : `${Math.round(node.confidence * 100)}%`,
  ].filter(Boolean);

  return (
    <div
      className={`w-44 border bg-background/95 px-3 py-2 text-left shadow-sm backdrop-blur ${nodeShape(node.kind)} ${nodeTone(node)} ${selected ? "ring-2 ring-oppulence-orange/60" : ""}`}
      aria-label={`${KIND_LABEL[node.kind]}: ${node.label}. ${badges.join(", ")}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/7 text-primary/70">
          <NodeIcon kind={node.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9px] uppercase tracking-wider text-primary/40">
            {KIND_LABEL[node.kind]}
          </span>
          <span className="mt-0.5 block line-clamp-2 text-xs font-medium leading-4 text-primary">
            {node.label}
          </span>
        </span>
        {node.changedSinceReview ? (
          <span
            className="size-2 shrink-0 rounded-full bg-oppulence-orange"
            title="Changed since review"
          />
        ) : null}
      </div>
      {badges.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.slice(0, 2).map((badge) => (
            <span
              key={badge}
              className="rounded-full bg-primary/6 px-1.5 py-0.5 text-[9px] capitalize text-primary/55"
            >
              {String(badge).replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TypedGraphEdge(props: EdgeProps<FlowEdge>) {
  const [hovered, setHovered] = React.useState(false);
  const [path, labelX, labelY] = getBezierPath(props);
  const showLabel = hovered || props.selected;
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        style={{
          stroke: props.selected
            ? "var(--oppulence-orange, #f97316)"
            : "color-mix(in oklab, var(--foreground) 42%, transparent)",
          strokeWidth: props.selected ? 2.25 : 1.5,
        }}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="cursor-pointer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`${props.data?.graphEdge.label || "relationship"} edge`}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-[2px] border border-border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary/65 shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {props.data?.graphEdge.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const NODE_TYPES = { relationshipNode: GraphNodeCard };
const EDGE_TYPES = { typedEdge: TypedGraphEdge };

function timestampForNode(node: RelationshipGraphNode): number {
  const raw = node.dueAt || node.occurredAt || node.updatedAt;
  const value = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function layoutNodes(
  nodes: RelationshipGraphNode[],
  layout: RelationshipGraphSavedViewState["layout"],
  density: number,
): FlowNode[] {
  const spacing = 0.72 + density * 0.7;
  if (layout === "radial") {
    const radius = Math.max(260, nodes.length * 18) * spacing;
    return nodes.map((node, index) => {
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      return {
        id: node.id,
        type: "relationshipNode",
        position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
        data: { graphNode: node },
        ariaLabel: `${KIND_LABEL[node.kind]} ${node.label}`,
      };
    });
  }

  if (layout === "timeline") {
    const ordered = [...nodes].sort(
      (left, right) => timestampForNode(left) - timestampForNode(right),
    );
    const rows = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
    return ordered.map((node, index) => ({
      id: node.id,
      type: "relationshipNode",
      position: {
        x: index * 205 * spacing,
        y: (rows.get(node.kind) || 0) * 118 * spacing,
      },
      data: { graphNode: node },
      ariaLabel: `${KIND_LABEL[node.kind]} ${node.label}`,
    }));
  }

  const grouped = new Map<RelationshipGraphNode["kind"], RelationshipGraphNode[]>();
  for (const node of nodes) grouped.set(node.kind, [...(grouped.get(node.kind) || []), node]);
  return KIND_ORDER.flatMap((kind, column) =>
    (grouped.get(kind) || []).map((node, row) => ({
      id: node.id,
      type: "relationshipNode" as const,
      position: { x: column * 220 * spacing, y: row * 112 * spacing },
      data: { graphNode: node },
      ariaLabel: `${KIND_LABEL[node.kind]} ${node.label}`,
    })),
  );
}

function readURLState(): RelationshipGraphSavedViewState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  const params = new URLSearchParams(window.location.search);
  if (params.get("graph") !== "1") return DEFAULT_STATE;
  const density = Number(params.get("graphDensity"));
  const candidate = {
    scope: params.get("graphScope") || undefined,
    relationshipId: params.get("graphRelationship") || undefined,
    query: params.get("graphQuery") || "",
    layout: params.get("graphLayout") || undefined,
    density: Number.isFinite(density) && density > 0 ? density : undefined,
    hideIsolated: params.get("graphHideIsolated") === "1",
    selectedNodeId: params.get("graphNode") || undefined,
    focusDepth: Number(params.get("graphFocusDepth") || 0),
    asOf: params.get("graphAsOf") || undefined,
    changedSinceReview: params.get("graphChanged") === "1",
  };
  const parsed = RelationshipGraphSavedViewSchema.shape.state.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_STATE;
}

function writeURLState(state: RelationshipGraphSavedViewState) {
  const url = new URL(window.location.href);
  url.searchParams.set("graph", "1");
  url.searchParams.set("graphScope", state.scope);
  url.searchParams.set("graphLayout", state.layout);
  url.searchParams.set("graphDensity", state.density.toFixed(2));
  const optional: Array<[string, string | undefined]> = [
    ["graphRelationship", state.relationshipId],
    ["graphQuery", state.query || undefined],
    ["graphNode", state.selectedNodeId],
    ["graphAsOf", state.asOf],
  ];
  for (const [key, value] of optional) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (state.hideIsolated) url.searchParams.set("graphHideIsolated", "1");
  else url.searchParams.delete("graphHideIsolated");
  if (state.focusDepth) url.searchParams.set("graphFocusDepth", String(state.focusDepth));
  else url.searchParams.delete("graphFocusDepth");
  if (state.changedSinceReview) url.searchParams.set("graphChanged", "1");
  else url.searchParams.delete("graphChanged");
  window.history.replaceState(null, "", url);
}

function loadSavedViews(): RelationshipGraphSavedView[] {
  if (typeof window === "undefined") return [];
  try {
    return RelationshipGraphSavedViewsSchema.parse(
      JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]"),
    );
  } catch {
    return [];
  }
}

function GraphCanvas({
  nodes: graphNodes,
  edges: graphEdges,
  layout,
  density,
  selectedNodeId,
  onSelectNode,
  resetSignal,
}: {
  nodes: RelationshipGraphNode[];
  edges: RelationshipGraphEdge[];
  layout: RelationshipGraphSavedViewState["layout"];
  density: number;
  selectedNodeId?: string;
  onSelectNode: (id?: string) => void;
  resetSignal: number;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const topologyKey = React.useMemo(
    () =>
      `${layout}:${density}:${graphNodes.map((node) => node.id).join("|")}:${graphEdges
        .map((edge) => edge.id)
        .join("|")}`,
    [density, graphEdges, graphNodes, layout],
  );

  React.useEffect(() => {
    setNodes(
      layoutNodes(graphNodes, layout, density).map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    );
    setEdges(
      graphEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "typedEdge",
        data: { graphEdge: edge },
        markerEnd: edge.directed
          ? { type: MarkerType.ArrowClosed, width: 14, height: 14 }
          : undefined,
        selectable: true,
        selected: Boolean(
          selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId),
        ),
      })),
    );
  }, [density, graphEdges, graphNodes, layout, selectedNodeId, setEdges, setNodes]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(
      () => void flow.fitView({ padding: 0.18, duration: 0 }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [flow, topologyKey]);

  React.useEffect(() => {
    void flow.fitView({ padding: 0.18, duration: 0 });
  }, [flow, resetSignal]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode(undefined)}
      nodesFocusable
      edgesFocusable
      elementsSelectable
      panOnDrag
      panOnScroll
      minZoom={0.15}
      maxZoom={2}
      fitView
      proOptions={{ hideAttribution: true }}
      aria-label="Relationship intelligence graph"
    >
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const graphNode = (node.data as GraphNodeData | undefined)?.graphNode;
          if (graphNode?.kind === "risk") return "#ef4444";
          if (graphNode?.kind === "relationship") return "#f97316";
          if (graphNode?.kind === "action") return "#22c55e";
          return "#64748b";
        }}
        className="!border !border-border !bg-background/90"
      />
      <Controls showInteractive={false} className="!border-border !bg-background" />
      <Panel
        position="top-right"
        className="rounded-[2px] border border-border bg-background/90 px-2 py-1 text-[10px] text-primary/50 backdrop-blur"
      >
        {graphNodes.length} nodes · {graphEdges.length} directed links
      </Panel>
    </ReactFlow>
  );
}

function Inspector({
  node,
  graph,
  busy,
  onSelectNode,
  onOpen,
  onAction,
  onPropose,
  focusDepth,
  onFocusDepth,
}: {
  node?: RelationshipGraphNode;
  graph: RelationshipGraph;
  busy: boolean;
  onSelectNode: (id: string) => void;
  onOpen: (relationshipId: string) => void;
  onAction: (kind: "evaluate" | "approve" | "reject", actionId: string) => void;
  onPropose: (node: RelationshipGraphNode) => void;
  focusDepth: RelationshipGraphSavedViewState["focusDepth"];
  onFocusDepth: (depth: RelationshipGraphSavedViewState["focusDepth"]) => void;
}) {
  if (!node) {
    return (
      <aside className="flex min-h-56 flex-col items-center justify-center border-l border-border p-6 text-center">
        <Graph className="size-7 text-primary/25" />
        <p className="mt-3 text-sm font-medium text-primary">Inspect the graph</p>
        <p className="mt-1 max-w-56 text-xs text-primary/45">
          Select a node to see state, evidence, connections, and governed next actions.
        </p>
      </aside>
    );
  }

  const relationshipIds = [
    ...new Set([node.relationshipId, ...node.relationshipIds].filter(Boolean)),
  ] as string[];
  const relationshipRecords = relationshipIds.map((id) => ({
    id,
    label:
      graph.nodes.find(
        (candidate) => candidate.kind === "relationship" && candidate.relationshipIds.includes(id),
      )?.label || "account",
  }));
  const connected = graph.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  const actionId = node.kind === "action" ? node.resourceRef : undefined;
  const evidenceNodes = graph.nodes.filter(
    (candidate) =>
      candidate.kind === "evidence" &&
      candidate.evidenceRefs.some((ref) => node.evidenceRefs.includes(ref)),
  );

  return (
    <aside
      className="min-h-0 overflow-y-auto border-l border-border bg-background-50/70 p-4 dark:bg-background-100/25"
      aria-label="Graph inspector"
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center border bg-background ${nodeShape(node.kind)} ${nodeTone(node)}`}
        >
          <NodeIcon kind={node.kind} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-primary/40">
            {KIND_LABEL[node.kind]}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-primary">{node.label}</h3>
        </div>
      </div>

      {node.summary ? (
        <p className="mt-3 text-xs leading-5 text-primary/60">{node.summary}</p>
      ) : null}
      <div className="mt-4 border border-border bg-background px-2 py-2">
        <p className="font-mono text-[9px] uppercase tracking-wide text-primary/35">
          Explore this node
        </p>
        <ToggleGroup
          type="single"
          value={String(focusDepth)}
          onValueChange={(value) => value && onFocusDepth(Number(value) as 0 | 1 | 2)}
          variant="outline"
          size="sm"
          className="mt-2 grid w-full grid-cols-3"
          aria-label="Graph neighborhood focus"
        >
          {([1, 2] as const).map((depth) => (
            <ToggleGroupItem
              key={depth}
              value={String(depth)}
              className="w-full text-xs data-[state=on]:border-oppulence-orange data-[state=on]:bg-oppulence-orange/10"
            >
              {depth} hop{depth === 1 ? "" : "s"}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem
            value="0"
            className="w-full text-xs data-[state=on]:border-primary/40 data-[state=on]:bg-primary/5"
          >
            Full graph
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="mt-1.5 text-[9px] leading-4 text-primary/35">
          Focus follows your selection, so you can walk the relationship one node at a time.
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        {[
          ["Status", node.status],
          ["Health", node.health],
          ["Lifecycle", node.lifecycle],
          ["Approval", node.approvalStatus],
          ["Policy", node.policyStatus],
          ["Freshness", node.freshness],
          [
            "Confidence",
            node.confidence === undefined ? undefined : `${Math.round(node.confidence * 100)}%`,
          ],
          ["Due", node.dueAt ? new Date(node.dueAt).toLocaleDateString() : undefined],
        ]
          .filter((entry) => entry[1])
          .map(([label, value]) => (
            <div key={label} className="border border-border bg-background px-2 py-2">
              <dt className="font-mono text-[9px] uppercase tracking-wide text-primary/35">
                {label}
              </dt>
              <dd className="mt-0.5 capitalize text-primary/70">
                {String(value).replaceAll("_", " ")}
              </dd>
            </div>
          ))}
      </dl>

      {node.changedSinceReview ? (
        <div className="mt-3 border border-oppulence-orange/25 bg-oppulence-orange/5 p-2 text-xs text-primary/65">
          <ClockCounterClockwise className="mr-1 inline size-4 text-oppulence-orange" />
          Changed since your last review
          {node.changedDimensions.length ? `: ${node.changedDimensions.join(", ")}` : "."}
        </div>
      ) : null}

      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-primary/40">Connections</p>
        <ul className="mt-2 space-y-1">
          {connected.slice(0, 12).map((edge) => {
            const otherId = edge.source === node.id ? edge.target : edge.source;
            const other = graph.nodes.find((candidate) => candidate.id === otherId);
            return other ? (
              <li key={edge.id}>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onSelectNode(other.id)}
                  className="h-auto w-full justify-start rounded-lg px-2 py-1.5 text-left"
                >
                  <NodeIcon kind={other.kind} />
                  <span className="min-w-0 flex-1 truncate">{other.label}</span>
                  <span
                    className="font-mono text-[9px] text-primary/35"
                    aria-label={`${edge.source === node.id ? "Outgoing" : "Incoming"}: ${edge.label}`}
                  >
                    {edge.source === node.id ? "→" : "←"} {edge.label}
                  </span>
                </Button>
              </li>
            ) : null;
          })}
          {!connected.length ? (
            <li className="text-xs text-primary/35">No visible connections.</li>
          ) : null}
        </ul>
      </div>

      {node.evidenceRefs.length ? (
        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-primary/40">
            Evidence · {node.evidenceRefs.length}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {evidenceNodes.slice(0, 6).map((evidence) => (
              <Button
                key={evidence.id}
                variant="outline"
                size="xs"
                onClick={() => onSelectNode(evidence.id)}
                className="text-primary/55"
              >
                {evidence.source || "evidence"}
              </Button>
            ))}
            {!evidenceNodes.length ? (
              <span className="text-[10px] text-primary/40">
                Evidence references retained in the record.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        {relationshipRecords.map((relationship) => (
          <Button key={relationship.id} size="sm" onClick={() => onOpen(relationship.id)}>
            {relationshipRecords.length === 1
              ? "Open complete record"
              : `Open ${relationship.label}`}
          </Button>
        ))}
        {node.kind !== "action" &&
        relationshipRecords.length === 1 &&
        graph.permissions.canContribute ? (
          <Button size="sm" variant="outline" onClick={() => onPropose(node)} disabled={busy}>
            <Sparkle /> Propose follow-up
          </Button>
        ) : null}
        {actionId && node.policyStatus !== "allowed" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction("evaluate", actionId)}
            disabled={busy}
          >
            <ShieldCheck /> Evaluate
          </Button>
        ) : null}
        {actionId && node.approvalStatus === "pending" && graph.permissions.canApprove ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("approve", actionId)}
              disabled={busy}
            >
              <Check /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("reject", actionId)}
              disabled={busy}
            >
              <X /> Reject
            </Button>
          </>
        ) : null}
      </div>
      {actionId ? (
        <p className="mt-2 text-[10px] leading-4 text-primary/40">
          Approval changes authorization only. Execution remains a separate explicit action in the
          full record.
        </p>
      ) : null}
      {node.kind !== "action" && relationshipRecords.length > 1 ? (
        <p className="mt-2 text-[10px] leading-4 text-primary/40">
          This node is shared across accounts. Open one account before proposing an action so the
          approval is scoped correctly.
        </p>
      ) : null}
    </aside>
  );
}

function GraphTable({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: RelationshipGraphNode[];
  edges: RelationshipGraphEdge[];
  selectedNodeId?: string;
  onSelectNode: (id: string) => void;
}) {
  return (
    <div
      className="h-full overflow-auto"
      role="region"
      aria-label="Relationship graph list view"
      tabIndex={0}
    >
      <Table className="border-collapse text-left text-xs">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="border-border font-mono text-xs uppercase text-primary/40">
            <TableHead className="px-3 py-2 font-normal">Node</TableHead>
            <TableHead className="px-3 py-2 font-normal">Type</TableHead>
            <TableHead className="px-3 py-2 font-normal">State</TableHead>
            <TableHead className="px-3 py-2 font-normal">Links</TableHead>
            <TableHead className="px-3 py-2 font-normal">Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((node) => (
            <TableRow
              key={node.id}
              className={`border-b border-border/70 ${selectedNodeId === node.id ? "bg-oppulence-orange/5" : ""}`}
            >
              <TableCell className="px-3 py-2">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onSelectNode(node.id)}
                  className="max-w-80 justify-start px-0 text-left text-primary hover:bg-transparent hover:underline"
                >
                  <NodeIcon kind={node.kind} /> <span className="truncate">{node.label}</span>
                </Button>
              </TableCell>
              <TableCell className="px-3 py-2 text-primary/55">{KIND_LABEL[node.kind]}</TableCell>
              <TableCell className="px-3 py-2 capitalize text-primary/55">
                {(
                  node.health ||
                  node.status ||
                  node.approvalStatus ||
                  node.freshness ||
                  "—"
                ).replaceAll("_", " ")}
              </TableCell>
              <TableCell className="px-3 py-2 text-primary/45">
                {edges.filter((edge) => edge.source === node.id || edge.target === node.id).length}
              </TableCell>
              <TableCell className="px-3 py-2 text-primary/45">{node.evidenceRefs.length}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function RelationshipGraphWorkspace({
  relationships,
  onOpenRelationship,
  onError,
  onNotice,
}: {
  relationships: RevenueRelationship[];
  onOpenRelationship: (id: string) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [viewState, setViewState] = React.useState<RelationshipGraphSavedViewState>(readURLState);
  const [graph, setGraph] = React.useState<RelationshipGraph | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<"canvas" | "table">("canvas");
  const [queryDraft, setQueryDraft] = React.useState(() => readURLState().query);
  const [savedViews, setSavedViews] = React.useState<RelationshipGraphSavedView[]>(loadSavedViews);
  const [activeSavedViewId, setActiveSavedViewId] = React.useState<string>();
  const [resetSignal, setResetSignal] = React.useState(0);
  const loadRequestRef = React.useRef(0);

  const load = React.useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (viewState.scope === "relationship" && !viewState.relationshipId) {
      setGraph(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setGraph(null);
    setLoadError(null);
    try {
      const nextGraph = await getRelationshipGraph({
        scope: viewState.scope,
        relationshipId: viewState.relationshipId,
        depth: 2,
        asOf: viewState.asOf,
      });
      if (requestId === loadRequestRef.current) {
        setGraph(nextGraph);
        setViewState((current) =>
          current.selectedNodeId &&
          !nextGraph.nodes.some((node) => node.id === current.selectedNodeId)
            ? { ...current, selectedNodeId: undefined, focusDepth: 0 }
            : current,
        );
      }
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      const message = errMessage(error, "Could not load the relationship graph.");
      setLoadError(message);
      onError(message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [onError, viewState.asOf, viewState.relationshipId, viewState.scope]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadRequestRef.current += 1;
    };
  }, [load]);

  React.useEffect(() => {
    writeURLState(viewState);
  }, [viewState]);

  const queryResult = React.useMemo(
    () =>
      graph && viewState.query
        ? queryRelationshipGraph(graph, viewState.query, { asOf: graph.asOf })
        : null,
    [graph, viewState.query],
  );

  const visible = React.useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    let nodes = graph.nodes;
    let edges = graph.edges;
    if (viewState.changedSinceReview) {
      const changedRelationships = new Set(
        graph.nodes
          .filter((node) => node.kind === "relationship" && node.changedSinceReview)
          .flatMap((node) => node.relationshipIds),
      );
      nodes = nodes.filter((node) =>
        node.relationshipIds.some((id) => changedRelationships.has(id)),
      );
    }
    if (queryResult) {
      const ids = new Set(queryResult.visibleNodeIds);
      nodes = nodes.filter((node) => ids.has(node.id));
      edges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    }
    if (viewState.focusDepth && viewState.selectedNodeId) {
      const neighborhood = relationshipGraphNeighborhood(
        { nodes, edges },
        viewState.selectedNodeId,
        viewState.focusDepth,
      );
      if (neighborhood.nodeIds.length) {
        const focusedNodeIds = new Set(neighborhood.nodeIds);
        nodes = nodes.filter((node) => focusedNodeIds.has(node.id));
        edges = edges.filter(
          (edge) => focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target),
        );
      }
    }
    if (viewState.hideIsolated) {
      const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
      nodes = nodes.filter((node) => connected.has(node.id));
    }
    const available = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => available.has(edge.source) && available.has(edge.target));

    const maxNodes = Math.round(40 + viewState.density * 180);
    if (nodes.length > maxNodes) {
      nodes = [...nodes]
        .sort((left, right) => {
          const score = (node: RelationshipGraphNode) =>
            (node.kind === "relationship" ? 100 : 0) +
            (node.changedSinceReview ? 50 : 0) +
            (node.kind === "risk" ? 30 : 0) +
            (node.kind === "action" ? 20 : 0) +
            (node.evidenceRefs.length ? 10 : 0);
          return score(right) - score(left);
        })
        .slice(0, maxNodes);
      const capped = new Set(nodes.map((node) => node.id));
      edges = edges.filter((edge) => capped.has(edge.source) && capped.has(edge.target));
    }
    return { nodes, edges };
  }, [
    graph,
    queryResult,
    viewState.changedSinceReview,
    viewState.density,
    viewState.focusDepth,
    viewState.hideIsolated,
    viewState.selectedNodeId,
  ]);

  const selectedNode = graph?.nodes.find((node) => node.id === viewState.selectedNodeId);
  const updateState = React.useCallback((patch: Partial<RelationshipGraphSavedViewState>) => {
    setViewState((current) => ({ ...current, ...patch }));
  }, []);
  const selectNode = React.useCallback(
    (selectedNodeId?: string) =>
      updateState({
        selectedNodeId,
        focusDepth: selectedNodeId ? viewState.focusDepth : 0,
      }),
    [updateState, viewState.focusDepth],
  );

  const saveView = () => {
    if (!graph?.permissions.canSaveViews) return;
    const label = window
      .prompt("Name this graph view", `Graph view ${savedViews.length + 1}`)
      ?.trim();
    if (!label) return;
    const saved = RelationshipGraphSavedViewSchema.parse(
      createRelationshipGraphSavedView({ label, state: viewState }),
    );
    const next = [...savedViews, saved];
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    setSavedViews(next);
    setActiveSavedViewId(saved.id);
    onNotice(`Saved “${saved.label}”.`);
  };

  const applySavedView = (id: string) => {
    const saved = savedViews.find((item) => item.id === id);
    if (!saved) return;
    setViewState(saved.state);
    setQueryDraft(saved.state.query);
    setActiveSavedViewId(saved.id);
  };

  const deleteSavedView = () => {
    if (!activeSavedViewId) return;
    const next = savedViews.filter((view) => view.id !== activeSavedViewId);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    setSavedViews(next);
    setActiveSavedViewId(undefined);
    onNotice("Saved graph view deleted.");
  };

  const shareView = async () => {
    writeURLState(viewState);
    try {
      await navigator.clipboard.writeText(window.location.href);
      onNotice("Graph deep link copied.");
    } catch {
      onError("Could not copy the graph link.");
    }
  };

  const governAction = async (kind: "evaluate" | "approve" | "reject", actionId: string) => {
    setBusy(true);
    try {
      if (kind === "evaluate") await evaluateAction(actionId);
      if (kind === "approve") await approveAction(actionId);
      if (kind === "reject")
        await rejectAction(actionId, "Rejected from relationship graph review.");
      onNotice(kind === "evaluate" ? "Policy evaluation completed." : `Action ${kind}d.`);
      await load();
    } catch (error) {
      onError(errMessage(error, `Could not ${kind} this action.`));
    } finally {
      setBusy(false);
    }
  };

  const proposeAction = async (node: RelationshipGraphNode) => {
    const relationshipId = node.relationshipId || node.relationshipIds[0];
    if (!relationshipId) return;
    setBusy(true);
    try {
      await createAction({
        relationshipId,
        actionType: "follow_up_task",
        channel: "task",
        executionMode: "draft",
        reason: `Follow up on ${KIND_LABEL[node.kind].toLowerCase()}: ${node.label}`,
        proposedMessage: node.summary || `Review and follow up on ${node.label}.`,
      });
      onNotice("Follow-up proposed. It still requires policy evaluation and approval.");
      await load();
    } catch (error) {
      onError(errMessage(error, "Could not propose a follow-up."));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    const next = { ...DEFAULT_STATE, relationshipId: undefined };
    setViewState(next);
    setQueryDraft("");
    setResetSignal((value) => value + 1);
  };

  return (
    <section
      className="overflow-hidden rounded-[2px] border border-border bg-background"
      data-capability={GRAPH_CAPABILITIES}
    >
      <div className="border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-oppulence-orange/10 text-oppulence-orange">
              <ShareNetwork className="size-4" weight="duotone" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-primary">Relationship graph</h2>
              <p className="text-[10px] text-primary/40">
                Versioned state, evidence, and governed action
              </p>
            </div>
          </div>
          <ToggleGroup
            type="single"
            value={viewState.scope}
            onValueChange={(value) => {
              const scope = value as RelationshipGraphSavedViewState["scope"];
              if (!scope) return;
              updateState({
                scope,
                relationshipId:
                  scope === "portfolio"
                    ? undefined
                    : viewState.relationshipId || relationships[0]?.id,
                selectedNodeId: undefined,
                focusDepth: 0,
              });
            }}
            variant="outline"
            size="sm"
            aria-label="Graph scope"
          >
            {(["portfolio", "relationship"] as const).map((scope) => (
              <ToggleGroupItem
                key={scope}
                value={scope}
                className="capitalize data-[state=on]:bg-primary data-[state=on]:text-background"
              >
                {scope === "relationship" ? "Account graph" : "Portfolio graph"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {viewState.scope === "relationship" ? (
            <Select
              value={viewState.relationshipId}
              onValueChange={(relationshipId) =>
                updateState({ relationshipId, selectedNodeId: undefined, focusDepth: 0 })
              }
            >
              <SelectTrigger size="sm" className="w-52">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-[2px]">
                {relationships.map((relationship) => (
                  <SelectItem key={relationship.id} value={relationship.id}>
                    {relationship.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <form
          className="mt-3 flex flex-col gap-2 lg:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            updateState({ query: queryDraft.trim(), selectedNodeId: undefined, focusDepth: 0 });
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Sparkle className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-oppulence-orange" />
            <Input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              className="pl-8"
              aria-label="Ask this graph"
              placeholder="Ask this graph, e.g. Which renewals depend on overdue commitments?"
            />
          </div>
          <Button type="submit" size="sm">
            Ask graph
          </Button>
          {viewState.query ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQueryDraft("");
                updateState({ query: "" });
              }}
            >
              <X /> Clear
            </Button>
          ) : null}
        </form>

        {queryResult ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-2 border border-oppulence-orange/20 bg-oppulence-orange/5 px-3 py-2 text-xs text-primary/65"
            aria-live="polite"
          >
            <Sparkle className="size-4 shrink-0 text-oppulence-orange" />
            <span className="mr-auto">{queryResult.answer}</span>
            {queryResult.parsed.applied.map((filter) => (
              <Badge key={filter} variant="outline" className="rounded-full font-normal">
                {filter}
              </Badge>
            ))}
            <span className="font-mono text-[10px] text-primary/45">
              {queryResult.evidenceRefs.length} evidence refs
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => value && setMode(value as "canvas" | "table")}
          variant="outline"
          size="sm"
          aria-label="Graph presentation"
        >
          <ToggleGroupItem value="canvas" className="data-[state=on]:bg-primary/10">
            <Graph /> Canvas
          </ToggleGroupItem>
          <ToggleGroupItem value="table" className="data-[state=on]:bg-primary/10">
            <ListBullets /> Table
          </ToggleGroupItem>
        </ToggleGroup>
        <Select
          value={viewState.layout}
          onValueChange={(layout: RelationshipGraphSavedViewState["layout"]) =>
            updateState({ layout })
          }
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="app-shell rounded-[2px]">
            <SelectItem value="force">Cluster layout</SelectItem>
            <SelectItem value="radial">Radial layout</SelectItem>
            <SelectItem value="timeline">Timeline layout</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs text-primary/50">
          Density
          <Slider
            min={0.25}
            max={1}
            step={0.05}
            value={[viewState.density]}
            onValueChange={(value) => updateState({ density: value[0] ?? DEFAULT_STATE.density })}
            className="w-20"
            aria-label="Graph density"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-primary/55">
          <Checkbox
            checked={viewState.hideIsolated}
            onCheckedChange={(checked) => updateState({ hideIsolated: checked === true })}
          />
          Hide isolated
        </label>
        <label className="flex items-center gap-1.5 text-xs text-primary/55">
          <Checkbox
            checked={viewState.changedSinceReview}
            onCheckedChange={(checked) => updateState({ changedSinceReview: checked === true })}
          />
          Changed since review
        </label>
        <DateTimePicker
          value={viewState.asOf}
          onChange={(value) =>
            updateState({
              asOf: value || undefined,
              selectedNodeId: undefined,
              focusDepth: 0,
            })
          }
          aria-label="Historical graph date"
          placeholder="Historical view"
          className="w-64"
        />
        <div className="ml-auto flex items-center gap-1">
          {savedViews.length ? (
            <Select value={activeSavedViewId} onValueChange={applySavedView}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="Saved views" />
              </SelectTrigger>
              <SelectContent className="app-shell rounded-[2px]">
                {savedViews.map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {view.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={saveView}
            disabled={!graph?.permissions.canSaveViews}
          >
            <FloppyDisk /> Save
          </Button>
          {activeSavedViewId ? (
            <Button type="button" size="sm" variant="ghost" onClick={deleteSavedView}>
              <X /> Delete
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void shareView()}>
            <Link /> Share
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            <ArrowCounterClockwise /> Reset
          </Button>
        </div>
      </div>

      <div className="grid min-h-[620px] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative min-h-[500px] bg-background">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-primary/45">
              <CircleNotch className="mr-2 size-4 animate-spin" /> Building authorized graph…
            </div>
          ) : loadError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <WarningDiamond className="size-7 text-destructive" />
              <p className="mt-2 max-w-lg text-sm text-primary/65">{loadError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => void load()}
              >
                Retry
              </Button>
            </div>
          ) : !graph ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-primary/45">
              Choose an account to build its graph.
            </div>
          ) : !visible.nodes.length ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <Graph className="size-7 text-primary/25" />
              <p className="mt-2 text-sm text-primary/55">No nodes match this view.</p>
              <Button type="button" variant="link" size="sm" onClick={reset} className="mt-2">
                Reset filters
              </Button>
            </div>
          ) : mode === "table" ? (
            <GraphTable
              nodes={visible.nodes}
              edges={visible.edges}
              selectedNodeId={viewState.selectedNodeId}
              onSelectNode={selectNode}
            />
          ) : (
            <ReactFlowProvider>
              <GraphCanvas
                nodes={visible.nodes}
                edges={visible.edges}
                layout={viewState.layout}
                density={viewState.density}
                selectedNodeId={viewState.selectedNodeId}
                onSelectNode={selectNode}
                resetSignal={resetSignal}
              />
            </ReactFlowProvider>
          )}
          {graph?.historical ? (
            <div className="absolute bottom-3 left-3 flex items-center gap-1 border border-amber-500/30 bg-background/90 px-2 py-1 text-[10px] text-amber-600 backdrop-blur dark:text-amber-400">
              <ClockCounterClockwise /> Historical as of {new Date(graph.asOf).toLocaleString()}
            </div>
          ) : null}
          {graph && viewState.focusDepth && viewState.selectedNodeId ? (
            <div className="absolute bottom-3 right-3 border border-oppulence-orange/25 bg-background/90 px-2 py-1 text-[10px] text-primary/55 backdrop-blur">
              Focused · {viewState.focusDepth} hop{viewState.focusDepth === 1 ? "" : "s"} ·{" "}
              {visible.nodes.length} nodes
              <Button
                variant="link"
                size="xs"
                onClick={() => updateState({ focusDepth: 0 })}
                className="ml-1 h-auto p-0 text-oppulence-orange"
              >
                Show all
              </Button>
            </div>
          ) : graph && graph.nodes.length > visible.nodes.length ? (
            <div className="absolute bottom-3 right-3 border border-border bg-background/90 px-2 py-1 text-[10px] text-primary/45">
              Showing {visible.nodes.length} of {graph.nodes.length} nodes · raise density for more
            </div>
          ) : null}
        </div>
        {graph ? (
          <Inspector
            node={selectedNode}
            graph={graph}
            busy={busy}
            onSelectNode={selectNode}
            onOpen={onOpenRelationship}
            onAction={(kind, actionId) => void governAction(kind, actionId)}
            onPropose={(node) => void proposeAction(node)}
            focusDepth={viewState.focusDepth}
            onFocusDepth={(focusDepth) => updateState({ focusDepth })}
          />
        ) : (
          <aside className="border-l border-border" />
        )}
      </div>
    </section>
  );
}
