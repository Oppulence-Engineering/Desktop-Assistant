"use client";

import * as React from "react";
import {
  createRelationshipGraphSavedView,
  queryRelationshipGraph,
  relationshipGraphNeighborhood,
} from "@oppulence/relationship-contract";
import { DEEP_LINK_SCHEME } from "@x/shared/branding";
import {
  RelationshipGraphSavedViewSchema,
  RelationshipGraphSavedViewsSchema,
  type Relationship,
  type RelationshipGraph,
  type RelationshipGraphNode,
  type RelationshipGraphSavedView,
  type RelationshipGraphSavedViewState,
} from "@x/shared/relationships";
import {
  ArrowCounterClockwise,
  Buildings,
  Check,
  CircleNotch,
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
import { toast } from "sonner";

import { GraphView, type GraphEdge, type GraphNode } from "@/components/graph-view";
import { userFacingError } from "@/lib/user-facing-error";
import { Badge } from "@oppulence/ui/components/badge";
import { Button } from "@oppulence/ui/components/button";
import { DateTimePicker } from "@oppulence/ui/components/date-time-picker";
import { Checkbox } from "@oppulence/ui/components/checkbox";
import { Slider } from "@oppulence/ui/components/slider";
import { Input } from "@oppulence/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@oppulence/ui/components/select";

const SAVED_VIEWS_KEY = "oppulence.relationship-graph.saved-views.v1";

const DEFAULT_STATE: RelationshipGraphSavedViewState = {
  scope: "portfolio",
  query: "",
  layout: "force",
  density: 0.72,
  hideIsolated: false,
  focusDepth: 0,
  changedSinceReview: false,
};

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

const KIND_COLOR: Record<RelationshipGraphNode["kind"], string> = {
  relationship: "#f97316",
  person: "#0ea5e9",
  commitment: "#8b5cf6",
  risk: "#ef4444",
  milestone: "#22c55e",
  action: "#14b8a6",
  evidence: "#64748b",
  source: "#06b6d4",
  note: "#eab308",
};

const STATE_COLOR: Record<string, string> = {
  healthy: "#10b981",
  needs_attention: "#f59e0b",
  critical: "#ef4444",
  current: "#06b6d4",
  aging: "#f59e0b",
  stale: "#ef4444",
  approved: "#10b981",
  pending: "#f59e0b",
  rejected: "#ef4444",
};

function NodeIcon({
  kind,
  className = "size-4",
}: {
  kind: RelationshipGraphNode["kind"];
  className?: string;
}) {
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
}

function shapeForNode(kind: RelationshipGraphNode["kind"]): GraphNode["shape"] {
  if (kind === "risk") return "diamond";
  if (kind === "commitment" || kind === "evidence") return "square";
  if (kind === "action" || kind === "source") return "pill";
  return "circle";
}

function stateBadge(node: RelationshipGraphNode) {
  if (node.confidence !== undefined) return `${Math.round(node.confidence * 100)}% confidence`;
  return node.health || node.approvalStatus || node.freshness || node.status;
}

function loadSavedViews(): RelationshipGraphSavedView[] {
  try {
    return RelationshipGraphSavedViewsSchema.parse(
      JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]"),
    );
  } catch {
    return [];
  }
}

function parseInitialState(raw?: string): RelationshipGraphSavedViewState {
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = RelationshipGraphSavedViewSchema.shape.state.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

function relationshipIdFor(node: RelationshipGraphNode) {
  return node.relationshipId || node.relationshipIds[0];
}

function GraphTable({
  nodes,
  edges,
  selectedNodeId,
  onSelect,
}: {
  nodes: RelationshipGraphNode[];
  edges: RelationshipGraph["edges"];
  selectedNodeId?: string;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = React.useState("");
  const filteredNodes = React.useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) return nodes;
    return nodes.filter((node) =>
      [node.label, KIND_LABEL[node.kind], stateBadge(node)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [filter, nodes]);

  return (
    <div
      className="h-full overflow-auto"
      role="region"
      aria-label="Relationship graph list view"
      tabIndex={0}
    >
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background p-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter graph table"
          placeholder="Filter nodes"
          className="max-w-xs"
        />
        <span className="text-[11px] text-primary/45">
          {filteredNodes.length} of {nodes.length} nodes
        </span>
      </div>
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border font-mono text-[10px] uppercase tracking-wide text-primary/40">
            <th className="px-3 py-2 font-normal">Node</th>
            <th className="px-3 py-2 font-normal">Type</th>
            <th className="px-3 py-2 font-normal">State</th>
            <th className="px-3 py-2 font-normal">Links</th>
            <th className="px-3 py-2 font-normal">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {filteredNodes.map((node) => (
            <tr
              key={node.id}
              className={`border-b border-border/70 ${selectedNodeId === node.id ? "bg-oppulence-orange/5" : ""}`}
            >
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSelect(node.id)}
                  className="flex max-w-80 items-center gap-2 text-left font-medium text-primary hover:underline"
                >
                  <NodeIcon kind={node.kind} /> <span className="truncate">{node.label}</span>
                </button>
              </td>
              <td className="px-3 py-2 text-primary/55">{KIND_LABEL[node.kind]}</td>
              <td className="px-3 py-2 capitalize text-primary/55">
                {(stateBadge(node) || "—").replaceAll("_", " ")}
              </td>
              <td className="px-3 py-2 text-primary/45">
                {edges.filter((edge) => edge.source === node.id || edge.target === node.id).length}
              </td>
              <td className="px-3 py-2 text-primary/45">{node.evidenceRefs.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Inspector({
  node,
  graph,
  busy,
  onSelect,
  onOpen,
  onGovern,
  onPropose,
  focusDepth,
  onFocusDepth,
}: {
  node?: RelationshipGraphNode;
  graph: RelationshipGraph;
  busy: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onGovern: (operation: "evaluate" | "approve" | "reject", actionId: string) => void;
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
          Select a node to inspect its state, evidence, connections, and governed actions.
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
  const actionId = node.kind === "action" ? node.resourceRef : undefined;
  const connections = graph.edges.filter(
    (edge) => edge.source === node.id || edge.target === node.id,
  );
  return (
    <aside
      className="min-h-0 overflow-y-auto border-l border-border bg-background-50/70 p-4 dark:bg-background-100/25"
      aria-label="Graph inspector"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-background">
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
        <div className="mt-2 grid grid-cols-3 gap-1" aria-label="Graph neighborhood focus">
          {([1, 2] as const).map((depth) => (
            <button
              key={depth}
              type="button"
              onClick={() => onFocusDepth(depth)}
              aria-pressed={focusDepth === depth}
              className={`border px-2 py-1.5 text-[10px] ${
                focusDepth === depth
                  ? "border-oppulence-orange bg-oppulence-orange/10 text-primary"
                  : "border-border text-primary/55 hover:bg-primary/5"
              }`}
            >
              {depth} hop{depth === 1 ? "" : "s"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFocusDepth(0)}
            aria-pressed={focusDepth === 0}
            className={`border px-2 py-1.5 text-[10px] ${
              focusDepth === 0
                ? "border-primary/40 bg-primary/5 text-primary"
                : "border-border text-primary/55 hover:bg-primary/5"
            }`}
          >
            Full graph
          </button>
        </div>
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
        <p className="mt-3 border border-oppulence-orange/25 bg-oppulence-orange/5 p-2 text-xs text-primary/65">
          Changed since your last review
          {node.changedDimensions.length ? `: ${node.changedDimensions.join(", ")}` : "."}
        </p>
      ) : null}

      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-primary/40">Connections</p>
        <ul className="mt-2 space-y-1">
          {connections.slice(0, 12).map((edge) => {
            const otherId = edge.source === node.id ? edge.target : edge.source;
            const other = graph.nodes.find((candidate) => candidate.id === otherId);
            return other ? (
              <li key={edge.id}>
                <button
                  type="button"
                  onClick={() => onSelect(other.id)}
                  className="flex w-full items-center gap-2 border border-border px-2 py-1.5 text-left text-xs hover:bg-primary/5"
                >
                  <NodeIcon kind={other.kind} />
                  <span className="min-w-0 flex-1 truncate">{other.label}</span>
                  <span
                    className="font-mono text-[9px] text-primary/35"
                    aria-label={`${edge.source === node.id ? "Outgoing" : "Incoming"}: ${edge.label}`}
                  >
                    {edge.source === node.id ? "→" : "←"} {edge.label}
                  </span>
                </button>
              </li>
            ) : null;
          })}
          {!connections.length ? (
            <li className="text-xs text-primary/35">No visible connections.</li>
          ) : null}
        </ul>
      </div>

      {node.evidenceRefs.length ? (
        <p className="mt-4 border border-border px-2 py-2 text-[10px] text-primary/45">
          <FileText className="mr-1 inline size-3" /> {node.evidenceRefs.length} retained evidence
          reference{node.evidenceRefs.length === 1 ? "" : "s"}
        </p>
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
            onClick={() => onGovern("evaluate", actionId)}
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
              onClick={() => onGovern("approve", actionId)}
              disabled={busy}
            >
              <Check /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onGovern("reject", actionId)}
              disabled={busy}
            >
              <X /> Reject
            </Button>
          </>
        ) : null}
      </div>
      {actionId ? (
        <p className="mt-2 text-[10px] leading-4 text-primary/40">
          Execution remains a separate explicit step in the complete action record.
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

export function RelationshipGraphWorkspace({
  relationships,
  initialState,
  onOpenRelationship,
  onError,
  onContextChange,
}: {
  relationships: Relationship[];
  initialState?: string;
  onOpenRelationship: (id: string) => void;
  onError: (message: string | null) => void;
  onContextChange?: (context: { label: string; detail?: string } | null) => void;
}) {
  const parsedInitialState = React.useMemo(() => parseInitialState(initialState), [initialState]);
  const [viewState, setViewState] = React.useState(parsedInitialState);
  const [queryDraft, setQueryDraft] = React.useState(parsedInitialState.query);
  const [graph, setGraph] = React.useState<RelationshipGraph | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<"canvas" | "table">("canvas");
  const [savedViews, setSavedViews] = React.useState<RelationshipGraphSavedView[]>(loadSavedViews);
  const [activeSavedViewId, setActiveSavedViewId] = React.useState<string>();
  const loadRequestRef = React.useRef(0);

  const updateState = React.useCallback((patch: Partial<RelationshipGraphSavedViewState>) => {
    setViewState((current) => ({ ...current, ...patch }));
  }, []);

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
    onError(null);
    try {
      const nextGraph = await window.ipc.invoke("relationships:graph", {
        scope: viewState.scope,
        relationshipId: viewState.relationshipId,
        depth: 2,
        asOf: viewState.asOf,
      });
      if (requestId === loadRequestRef.current) setGraph(nextGraph);
    } catch (cause) {
      if (requestId !== loadRequestRef.current) return;
      const message = userFacingError(cause, "Could not load the relationship graph.");
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
      const relationshipIds = new Set(
        graph.nodes
          .filter((node) => node.kind === "relationship" && node.changedSinceReview)
          .flatMap((node) => node.relationshipIds),
      );
      nodes = nodes.filter((node) => node.relationshipIds.some((id) => relationshipIds.has(id)));
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
    // A natural-language answer and its evidence must stay in sync. Density is a portfolio
    // browsing control, not permission to silently remove query results.
    if (!queryResult && nodes.length > maxNodes) {
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

  const relationshipLabels = React.useMemo(
    () =>
      new Map(
        graph?.nodes
          .filter((node) => node.kind === "relationship")
          .map((node) => [relationshipIdFor(node), node.label]),
      ),
    [graph],
  );
  const canvasNodes = React.useMemo<GraphNode[]>(
    () =>
      [...visible.nodes]
        .sort((left, right) => {
          if (viewState.layout !== "timeline") return 0;
          const timestamp = (node: RelationshipGraphNode) => {
            const value = node.dueAt || node.occurredAt || node.updatedAt;
            const time = value ? new Date(value).getTime() : 0;
            return Number.isFinite(time) ? time : 0;
          };
          return timestamp(left) - timestamp(right);
        })
        .map((node) => {
          const state = node.health || node.freshness || node.approvalStatus || "";
          return {
            id: node.id,
            label: node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label,
            degree: visible.edges.filter(
              (edge) => edge.source === node.id || edge.target === node.id,
            ).length,
            radius: node.kind === "relationship" ? 20 : node.kind === "risk" ? 16 : 14,
            group: relationshipLabels.get(relationshipIdFor(node)) || KIND_LABEL[node.kind],
            color: KIND_COLOR[node.kind],
            stroke: STATE_COLOR[state] || "#94a3b8",
            shape: shapeForNode(node.kind),
            icon: <NodeIcon kind={node.kind} className="size-4" />,
            badge: stateBadge(node),
            ariaLabel: `${KIND_LABEL[node.kind]}: ${node.label}. ${stateBadge(node) || "No status"}`,
            priorityLabel: node.kind === "relationship",
          };
        }),
    [relationshipLabels, viewState.layout, visible.edges, visible.nodes],
  );
  const canvasEdges = React.useMemo<GraphEdge[]>(
    () =>
      visible.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        kind: edge.kind,
        directed: edge.directed,
      })),
    [visible.edges],
  );

  const selectedNode = graph?.nodes.find((node) => node.id === viewState.selectedNodeId);
  React.useEffect(() => {
    if (selectedNode) {
      onContextChange?.({
        label: selectedNode.label,
        detail: `${KIND_LABEL[selectedNode.kind]} selected in the relationship graph`,
      });
      return;
    }
    onContextChange?.({
      label:
        viewState.scope === "portfolio"
          ? "Portfolio relationship graph"
          : "Account relationship graph",
      detail: `${visible.nodes.length} visible node${visible.nodes.length === 1 ? "" : "s"}`,
    });
  }, [onContextChange, selectedNode, viewState.scope, visible.nodes.length]);
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
    toast.success(`Saved “${saved.label}”.`);
  };
  const shareView = async () => {
    const link = `${DEEP_LINK_SCHEME}://open?type=relationships&graphState=${encodeURIComponent(JSON.stringify(viewState))}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Graph deep link copied.");
    } catch {
      onError("Could not copy the graph link.");
    }
  };
  const deleteSavedView = () => {
    if (!activeSavedViewId) return;
    const next = savedViews.filter((view) => view.id !== activeSavedViewId);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    setSavedViews(next);
    setActiveSavedViewId(undefined);
    toast.success("Saved graph view deleted.");
  };
  const govern = async (operation: "evaluate" | "approve" | "reject", actionId: string) => {
    setBusy(true);
    try {
      if (operation === "evaluate")
        await window.ipc.invoke("relationships:evaluateAction", { actionId });
      if (operation === "approve") await window.ipc.invoke("relationships:approve", { actionId });
      if (operation === "reject")
        await window.ipc.invoke("relationships:reject", {
          actionId,
          reason: "Rejected from relationship graph review.",
        });
      toast.success(
        operation === "evaluate" ? "Policy evaluation completed." : `Action ${operation}d.`,
      );
      await load();
    } catch (cause) {
      onError(userFacingError(cause, `Could not ${operation} this action.`));
    } finally {
      setBusy(false);
    }
  };
  const propose = async (node: RelationshipGraphNode) => {
    const relationshipId = relationshipIdFor(node);
    if (!relationshipId) return;
    setBusy(true);
    try {
      await window.ipc.invoke("relationships:createAction", {
        relationshipId,
        actionType: "follow_up_task",
        channel: "task",
        executionMode: "draft",
        reason: `Follow up on ${KIND_LABEL[node.kind].toLowerCase()}: ${node.label}`,
        proposedMessage: node.summary || `Review and follow up on ${node.label}.`,
      });
      toast.success("Follow-up proposed. It still requires evaluation and approval.");
      await load();
    } catch (cause) {
      onError(userFacingError(cause, "Could not propose a follow-up."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="overflow-hidden rounded-[2px] border border-border bg-background"
      data-capability="relationship-graph graph-query graph-saved-views graph-governed-actions"
    >
      <div className="border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-oppulence-orange/10 text-oppulence-orange">
            <ShareNetwork weight="duotone" />
          </span>
          <div className="mr-auto">
            <h2 className="text-sm font-semibold text-primary">Relationship graph</h2>
            <p className="text-[10px] text-primary/40">
              Versioned state, evidence, and governed action
            </p>
          </div>
          <div className="flex border border-border">
            {(["portfolio", "relationship"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() =>
                  updateState({
                    scope,
                    relationshipId:
                      scope === "portfolio"
                        ? undefined
                        : viewState.relationshipId || relationships[0]?.id,
                    selectedNodeId: undefined,
                    focusDepth: 0,
                  })
                }
                className={`px-3 py-1.5 text-xs ${viewState.scope === scope ? "bg-primary text-background" : "text-primary/55"}`}
              >
                {scope === "portfolio" ? "Portfolio graph" : "Account graph"}
              </button>
            ))}
          </div>
          {viewState.scope === "relationship" ? (
            <Select
              value={viewState.relationshipId}
              onValueChange={(relationshipId) =>
                updateState({ relationshipId, selectedNodeId: undefined, focusDepth: 0 })
              }
            >
              <SelectTrigger size="sm" className="w-48">
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
          className="mt-3 flex gap-2"
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
              size="sm"
              variant="ghost"
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
            <Sparkle className="size-4 text-oppulence-orange" />
            <span className="mr-auto">{queryResult.answer}</span>
            {queryResult.parsed.applied.map((filter) => (
              <Badge key={filter} variant="outline" className="rounded-full font-normal">
                {filter}
              </Badge>
            ))}
            <span className="font-mono text-[10px]">
              {queryResult.evidenceRefs.length} evidence refs
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex border border-border">
          <button
            type="button"
            onClick={() => setMode("canvas")}
            className={`flex items-center gap-1 px-2 py-1 text-xs ${mode === "canvas" ? "bg-primary/10" : "text-primary/45"}`}
          >
            <Graph /> Canvas
          </button>
          <button
            type="button"
            onClick={() => setMode("table")}
            className={`flex items-center gap-1 px-2 py-1 text-xs ${mode === "table" ? "bg-primary/10" : "text-primary/45"}`}
          >
            <ListBullets /> Table
          </button>
        </div>
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
        <label className="flex items-center gap-2 text-[11px] text-primary/50">
          Density{" "}
          <Slider
            min={0.25}
            max={1}
            step={0.05}
            value={[viewState.density]}
            onValueChange={([density]) => updateState({ density })}
            className="w-20"
            aria-label="Graph density"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-primary/55">
          <Checkbox
            checked={viewState.hideIsolated}
            onCheckedChange={(checked) => updateState({ hideIsolated: checked === true })}
          />{" "}
          Hide isolated
        </label>
        <label className="flex items-center gap-1 text-[11px] text-primary/55">
          <Checkbox
            checked={viewState.changedSinceReview}
            onCheckedChange={(checked) => updateState({ changedSinceReview: checked === true })}
          />{" "}
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
            <Select
              value={activeSavedViewId}
              onValueChange={(id) => {
                const saved = savedViews.find((view) => view.id === id);
                if (saved) {
                  setViewState(saved.state);
                  setQueryDraft(saved.state.query);
                  setActiveSavedViewId(saved.id);
                }
              }}
            >
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
          <Button size="sm" variant="ghost" onClick={saveView}>
            <FloppyDisk /> Save
          </Button>
          {activeSavedViewId ? (
            <Button size="sm" variant="ghost" onClick={deleteSavedView}>
              <X /> Delete
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void shareView()}>
            <Link /> Share
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setViewState(DEFAULT_STATE);
              setQueryDraft("");
              setActiveSavedViewId(undefined);
            }}
          >
            <ArrowCounterClockwise /> Reset
          </Button>
        </div>
      </div>

      <div className="relationship-graph-stage grid min-h-[600px] grid-cols-[minmax(0,1fr)_310px]">
        <div className="relative min-h-[520px]">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-primary/45">
              <CircleNotch className="mr-2 animate-spin" /> Building authorized graph…
            </div>
          ) : loadError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <WarningDiamond className="size-7 text-destructive" />
              <p className="mt-2 max-w-lg text-sm text-primary/65">{loadError}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : !graph ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-primary/45">
              Choose an account to build its graph.
            </div>
          ) : !visible.nodes.length ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-primary/45">
              No nodes match this view.
            </div>
          ) : mode === "table" ? (
            <GraphTable
              nodes={visible.nodes}
              edges={visible.edges}
              selectedNodeId={viewState.selectedNodeId}
              onSelect={selectNode}
            />
          ) : (
            <GraphView
              nodes={canvasNodes}
              edges={canvasEdges}
              selectedNodeId={viewState.selectedNodeId}
              onSelectNode={selectNode}
              showMiniMap
              layout={viewState.layout}
            />
          )}
          {graph?.historical ? (
            <div className="absolute bottom-3 left-3 border border-amber-500/30 bg-background/90 px-2 py-1 text-[10px] text-amber-600">
              Historical as of {new Date(graph.asOf).toLocaleString()}
            </div>
          ) : null}
          {graph && viewState.focusDepth && viewState.selectedNodeId ? (
            <div className="absolute bottom-3 right-3 border border-oppulence-orange/25 bg-background/90 px-2 py-1 text-[10px] text-primary/55 backdrop-blur">
              Focused · {viewState.focusDepth} hop{viewState.focusDepth === 1 ? "" : "s"} ·{" "}
              {visible.nodes.length} nodes
              <button
                type="button"
                onClick={() => updateState({ focusDepth: 0 })}
                className="ml-2 text-oppulence-orange"
              >
                Show all
              </button>
            </div>
          ) : queryResult ? (
            <div className="absolute bottom-3 right-3 border border-border bg-background/90 px-2 py-1 text-[10px] text-primary/45">
              Query view · {visible.nodes.length} node{visible.nodes.length === 1 ? "" : "s"} ·{" "}
              {queryResult.evidenceRefs.length} evidence reference
              {queryResult.evidenceRefs.length === 1 ? "" : "s"}
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
            onSelect={selectNode}
            onOpen={onOpenRelationship}
            onGovern={(operation, actionId) => void govern(operation, actionId)}
            onPropose={(node) => void propose(node)}
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
