import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "@/lib/icons";
import { Button } from "@oppulence/ui/components/button";
import { Input } from "@oppulence/ui/components/input";

export type GraphNode = {
  id: string;
  label: string;
  degree: number;
  radius: number;
  group: string;
  color: string;
  stroke: string;
  shape?: "circle" | "square" | "diamond" | "pill";
  icon?: React.ReactNode;
  ariaLabel?: string;
  badge?: string;
  priorityLabel?: boolean;
};

export type GraphEdge = {
  id?: string;
  source: string;
  target: string;
  label?: string;
  kind?: string;
  directed?: boolean;
};

type GraphViewProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  isLoading?: boolean;
  error?: string | null;
  onSelectNode?: (id: string) => void;
  selectedNodeId?: string;
  showMiniMap?: boolean;
  layout?: "force" | "radial" | "timeline";
  emptyState?: React.ReactNode;
};

type NodePosition = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

const SIMULATION_STEPS = 240;
const SPRING_LENGTH = 80;
const SPRING_STRENGTH = 0.0038;
const REPULSION = 5800;
const DAMPING = 0.83;
const MIN_DISTANCE = 34;
const CLUSTER_STRENGTH = 0.0018;
const CLUSTER_RADIUS_MIN = 120;
const CLUSTER_RADIUS_MAX = 240;
const CLUSTER_RADIUS_STEP = 45;
const FLOAT_BASE = 3.5;
const FLOAT_VARIANCE = 2;
const FLOAT_SPEED_BASE = 0.0006;
const FLOAT_SPEED_VARIANCE = 0.00025;
const MAX_FORCE_SIMULATION_NODES = 180;
const MAX_AMBIENT_ANIMATION_NODES = 140;
const MAX_LAYOUT_CACHE_ENTRIES = 4;
const topologyLayoutCache = new Map<string, Map<string, NodePosition>>();
const latestNodePositions = new Map<string, NodePosition>();

const clonePositions = (positions: Map<string, NodePosition>) =>
  new Map(Array.from(positions, ([id, position]) => [id, { ...position }]));

const rememberLayout = (key: string, positions: Map<string, NodePosition>) => {
  topologyLayoutCache.delete(key);
  topologyLayoutCache.set(key, clonePositions(positions));
  for (const [id, position] of positions) latestNodePositions.set(id, { ...position });
  while (topologyLayoutCache.size > MAX_LAYOUT_CACHE_ENTRIES) {
    const oldest = topologyLayoutCache.keys().next().value;
    if (oldest) topologyLayoutCache.delete(oldest);
    else break;
  }
};

export function GraphView({
  nodes,
  edges,
  isLoading,
  error,
  onSelectNode,
  selectedNodeId,
  showMiniMap = false,
  layout = "force",
  emptyState,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<Map<string, NodePosition>>(new Map());
  const draggingRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const panningRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const hasCenteredRef = useRef(false);
  const autoFittedTopologyRef = useRef<string | undefined>(undefined);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.6);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [motionTime, setMotionTime] = useState(0);
  const [positionSnapshot, setPositionSnapshot] = useState<Map<string, NodePosition>>(new Map());
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);
  const topologyKey = useMemo(
    () =>
      `${layout}|${nodes
        .map((node) => `${node.id}:${node.group}`)
        .sort()
        .join(";")}|${edges
        .map((edge) => `${edge.source}>${edge.target}`)
        .sort()
        .join(";")}`,
    [edges, layout, nodes],
  );
  const useStaticLayout = nodes.length > MAX_FORCE_SIMULATION_NODES || layout !== "force";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const edgeList = useMemo(() => edges.filter((edge) => edge.source !== edge.target), [edges]);
  const nodeGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node) => map.set(node.id, node.group || "root"));
    return map;
  }, [nodes]);
  const legendItems = useMemo(() => {
    const grouped = new Map<
      string,
      { group: string; label: string; color: string; stroke: string }
    >();
    nodes.forEach((node) => {
      const group = node.group || "root";
      if (grouped.has(group)) return;
      grouped.set(group, {
        group,
        label: group === "root" ? "knowledge" : group,
        color: node.color,
        stroke: node.stroke,
      });
    });
    return Array.from(grouped.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [nodes]);
  const groupCenters = useMemo(() => {
    const groups = Array.from(new Set(nodes.map((node) => node.group || "root")));
    if (groups.length === 0) return new Map<string, { x: number; y: number }>();
    const radius = Math.min(
      CLUSTER_RADIUS_MAX,
      Math.max(CLUSTER_RADIUS_MIN, groups.length * CLUSTER_RADIUS_STEP),
    );
    const centers = new Map<string, { x: number; y: number }>();
    groups.forEach((group, index) => {
      const angle = (index / groups.length) * Math.PI * 2;
      centers.set(group, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    });
    return centers;
  }, [nodes]);

  const getMotionSeed = useCallback((id: string) => {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    const normalized = Math.abs(hash);
    const phase = ((normalized % 360) * Math.PI) / 180;
    const amplitude = FLOAT_BASE + (normalized % 7) * (FLOAT_VARIANCE / 6);
    const speed = FLOAT_SPEED_BASE + (normalized % 5) * FLOAT_SPEED_VARIANCE;
    return { phase, amplitude, speed };
  }, []);

  const getDisplayPosition = useCallback(
    (id: string, base: NodePosition, skipMotion: boolean) => {
      if (skipMotion) {
        return { x: base.x, y: base.y };
      }
      const seed = getMotionSeed(id);
      const phase = seed.phase + motionTime * seed.speed;
      return {
        x: base.x + Math.sin(phase) * seed.amplitude,
        y: base.y + Math.cos(phase * 0.9) * seed.amplitude,
      };
    },
    [getMotionSeed, motionTime],
  );

  const commitPositions = useCallback(() => {
    setPositionSnapshot(clonePositions(positionsRef.current));
  }, []);

  const getGraphPoint = useCallback(
    (event: React.PointerEvent) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - pan.x) / zoom,
        y: (event.clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewport({ width, height });
      if (!hasCenteredRef.current) {
        setPan({ x: width / 2, y: height / 2 });
        hasCenteredRef.current = true;
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (nodes.length === 0) {
      positionsRef.current = new Map();
      return;
    }

    const cachedLayout = topologyLayoutCache.get(topologyKey);
    if (cachedLayout && cachedLayout.size === nodes.length) {
      positionsRef.current = clonePositions(cachedLayout);
      const frame = requestAnimationFrame(commitPositions);
      return () => cancelAnimationFrame(frame);
    }

    const nextPositions = new Map<string, NodePosition>();
    const count = nodes.length;
    const radius = Math.max(110, Math.min(220, count * 9));
    let reusedPositions = 0;

    const groupCounts = new Map<string, number>();
    const groupIndexes = new Map<string, number>();
    nodes.forEach((node) => {
      const group = node.group || "root";
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    });

    nodes.forEach((node, index) => {
      const existing = positionsRef.current.get(node.id) ?? latestNodePositions.get(node.id);
      if (existing) {
        nextPositions.set(node.id, { ...existing });
        reusedPositions += 1;
        return;
      }
      if (layout === "timeline") {
        const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
        nextPositions.set(node.id, {
          x: (index % columns) * 120 - ((columns - 1) * 120) / 2,
          y: Math.floor(index / columns) * 90 - 120,
          vx: 0,
          vy: 0,
        });
        return;
      }
      if (useStaticLayout) {
        const group = node.group || "root";
        const groupIndex = groupIndexes.get(group) ?? 0;
        groupIndexes.set(group, groupIndex + 1);
        const groupCount = groupCounts.get(group) ?? 1;
        const center = groupCenters.get(group) ?? { x: 0, y: 0 };
        const localRadius = Math.max(40, Math.min(180, groupCount * 5));
        const angle = (groupIndex / groupCount) * Math.PI * 2;
        nextPositions.set(node.id, {
          x: center.x + localRadius * Math.cos(angle),
          y: center.y + localRadius * Math.sin(angle),
          vx: 0,
          vy: 0,
        });
        return;
      }
      const angle = (index / count) * Math.PI * 2;
      nextPositions.set(node.id, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      });
    });

    positionsRef.current = nextPositions;

    if (useStaticLayout) {
      rememberLayout(topologyKey, positionsRef.current);
      const frame = requestAnimationFrame(commitPositions);
      return () => cancelAnimationFrame(frame);
    }

    let step = 0;
    const simulationSteps = reusedPositions / count >= 0.8 ? 72 : SIMULATION_STEPS;
    let rafId = 0;
    let active = true;

    const simulate = () => {
      if (!active) return;
      step += 1;

      const positions = positionsRef.current;
      const ids = nodeIds;
      const forces = new Map<string, { x: number; y: number }>();

      ids.forEach((id) => forces.set(id, { x: 0, y: 0 }));

      for (let i = 0; i < ids.length; i += 1) {
        const idA = ids[i];
        const posA = positions.get(idA);
        if (!posA) continue;
        for (let j = i + 1; j < ids.length; j += 1) {
          const idB = ids[j];
          const posB = positions.get(idB);
          if (!posB) continue;
          const dx = posB.x - posA.x;
          const dy = posB.y - posA.y;
          const distance = Math.max(MIN_DISTANCE, Math.hypot(dx, dy));
          const force = REPULSION / (distance * distance);
          const fx = (force * dx) / distance;
          const fy = (force * dy) / distance;
          const forceA = forces.get(idA);
          const forceB = forces.get(idB);
          if (forceA) {
            forceA.x -= fx;
            forceA.y -= fy;
          }
          if (forceB) {
            forceB.x += fx;
            forceB.y += fy;
          }
        }
      }

      edgeList.forEach((edge) => {
        const posA = positions.get(edge.source);
        const posB = positions.get(edge.target);
        if (!posA || !posB) return;
        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;
        const distance = Math.max(20, Math.hypot(dx, dy));
        const delta = distance - SPRING_LENGTH;
        const force = delta * SPRING_STRENGTH;
        const fx = (force * dx) / distance;
        const fy = (force * dy) / distance;
        const forceA = forces.get(edge.source);
        const forceB = forces.get(edge.target);
        if (forceA) {
          forceA.x += fx;
          forceA.y += fy;
        }
        if (forceB) {
          forceB.x -= fx;
          forceB.y -= fy;
        }
      });

      ids.forEach((id) => {
        const pos = positions.get(id);
        const force = forces.get(id);
        if (!pos || !force) return;
        const group = nodeGroupMap.get(id) ?? "root";
        const center = groupCenters.get(group);
        if (!center) return;
        const dx = center.x - pos.x;
        const dy = center.y - pos.y;
        force.x += dx * CLUSTER_STRENGTH;
        force.y += dy * CLUSTER_STRENGTH;
      });

      ids.forEach((id) => {
        const pos = positions.get(id);
        const force = forces.get(id);
        if (!pos || !force) return;
        if (draggingRef.current?.id === id) {
          pos.vx = 0;
          pos.vy = 0;
          return;
        }
        pos.vx = (pos.vx + force.x) * DAMPING;
        pos.vy = (pos.vy + force.y) * DAMPING;
        pos.x += pos.vx;
        pos.y += pos.vy;
      });

      commitPositions();

      if (step < simulationSteps) {
        rafId = requestAnimationFrame(simulate);
      } else {
        rememberLayout(topologyKey, positionsRef.current);
      }
    };

    rafId = requestAnimationFrame(simulate);
    return () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      rememberLayout(topologyKey, positionsRef.current);
    };
  }, [
    nodes,
    nodeIds,
    edgeList,
    commitPositions,
    groupCenters,
    layout,
    layoutVersion,
    nodeGroupMap,
    topologyKey,
    useStaticLayout,
  ]);

  useEffect(() => {
    if (reducedMotion || nodes.length === 0 || nodes.length > MAX_AMBIENT_ANIMATION_NODES) return;
    let rafId = 0;
    let lastTime = performance.now();

    const animate = (time: number) => {
      const delta = time - lastTime;
      if (delta >= 32) {
        setMotionTime((value) => value + delta);
        lastTime = time;
      }
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [nodes.length, reducedMotion]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panningRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const dragging = draggingRef.current;
    if (dragging) {
      const point = getGraphPoint(event);
      const pos = positionsRef.current.get(dragging.id);
      if (pos) {
        pos.x = point.x - dragging.offsetX;
        pos.y = point.y - dragging.offsetY;
        dragging.moved = true;
        commitPositions();
      }
      return;
    }

    const panning = panningRef.current;
    if (panning) {
      setPan({
        x: panning.originX + (event.clientX - panning.startX),
        y: panning.originY + (event.clientY - panning.startY),
      });
    }
  };

  const handlePointerUp = () => {
    const dragging = draggingRef.current;
    if (dragging) {
      if (!dragging.moved) {
        onSelectNode?.(dragging.id);
      }
      draggingRef.current = null;
      setDraggingNodeId(null);
    }
    panningRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const rawDelta = event.deltaY;
    const normalizedDelta =
      event.deltaMode === 1
        ? rawDelta * 16
        : event.deltaMode === 2
          ? rawDelta * viewport.height
          : rawDelta;
    const sensitivity = Math.abs(normalizedDelta) < 40 ? 0.004 : 0.0022;
    const zoomFactor = Math.exp(-normalizedDelta * sensitivity);
    const nextZoom = Math.min(2.5, Math.max(0.4, zoom * zoomFactor));
    if (nextZoom === zoom) return;

    const container = containerRef.current;
    if (!container) {
      setZoom(nextZoom);
      return;
    }

    const rect = container.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const graphX = (cursorX - pan.x) / zoom;
    const graphY = (cursorY - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({
      x: cursorX - graphX * nextZoom,
      y: cursorY - graphY * nextZoom,
    });
  };

  const startDragNode = (event: React.PointerEvent, nodeId: string) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getGraphPoint(event);
    const pos = positionsRef.current.get(nodeId);
    if (!pos) return;
    const displayPos = getDisplayPosition(nodeId, pos, false);
    draggingRef.current = {
      id: nodeId,
      offsetX: point.x - displayPos.x,
      offsetY: point.y - displayPos.y,
      moved: false,
    };
    setDraggingNodeId(nodeId);
  };

  const displayPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node) => {
      const position = positionSnapshot.get(node.id);
      if (!position) return;
      positions.set(node.id, getDisplayPosition(node.id, position, draggingNodeId === node.id));
    });
    return positions;
  }, [draggingNodeId, getDisplayPosition, nodes, positionSnapshot]);
  const activeNodeId = hoveredNodeId ?? draggingNodeId ?? selectedNodeId ?? null;
  const connectedNodes = useMemo(() => {
    if (!activeNodeId) return null;
    const set = new Set([activeNodeId]);
    edgeList.forEach((edge) => {
      if (edge.source === activeNodeId) set.add(edge.target);
      if (edge.target === activeNodeId) set.add(edge.source);
    });
    return set;
  }, [activeNodeId, edgeList]);

  const searchMatchingNodes = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase();
    const directMatches = new Set<string>();
    nodes.forEach((node) => {
      if (node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query)) {
        directMatches.add(node.id);
      }
    });
    // Include immediate connections of matching nodes
    const withConnections = new Set(directMatches);
    edgeList.forEach((edge) => {
      if (directMatches.has(edge.source)) withConnections.add(edge.target);
      if (directMatches.has(edge.target)) withConnections.add(edge.source);
    });
    return { matches: withConnections, directMatches };
  }, [searchQuery, nodes, edgeList]);

  const fitGraph = useCallback(() => {
    const positions = Array.from(displayPositions.values());
    if (!positions.length) return;
    const xs = positions.map((position) => position.x);
    const ys = positions.map((position) => position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(120, maxX - minX + 100);
    const height = Math.max(120, maxY - minY + 100);
    const nextZoom = Math.min(
      2.5,
      Math.max(0.4, Math.min(viewport.width / width, viewport.height / height)),
    );
    setZoom(nextZoom);
    setPan({
      x: viewport.width / 2 - ((minX + maxX) / 2) * nextZoom,
      y: viewport.height / 2 - ((minY + maxY) / 2) * nextZoom,
    });
  }, [displayPositions, viewport.height, viewport.width]);

  useEffect(() => {
    if (
      displayPositions.size !== nodes.length ||
      nodes.length === 0 ||
      autoFittedTopologyRef.current === topologyKey
    ) {
      return;
    }
    autoFittedTopologyRef.current = topologyKey;
    const frame = requestAnimationFrame(fitGraph);
    return () => cancelAnimationFrame(frame);
  }, [displayPositions, fitGraph, nodes.length, topologyKey]);

  const resetGraph = useCallback(() => {
    topologyLayoutCache.delete(topologyKey);
    positionsRef.current.clear();
    setZoom(0.6);
    setPan({ x: viewport.width / 2, y: viewport.height / 2 });
    setLayoutVersion((version) => version + 1);
  }, [topologyKey, viewport.height, viewport.width]);

  return (
    <div
      ref={containerRef}
      className="graph-view relative h-full w-full"
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      {error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!error && nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {/* ... (ERRORS.md E09) Distinguish "still building" from a truly empty graph. */}
          {isLoading ? "Building graph…" : (emptyState ?? "No notes found.")}
        </div>
      ) : null}

      {legendItems.length > 0 ? (
        <div
          className="absolute right-3 top-3 z-20 rounded-none border border-border/80 bg-background/90 px-3 py-2 text-xs text-foreground shadow-sm backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Groups
          </div>
          <div className="grid gap-1">
            {legendItems.map((item) => {
              const isSelected = selectedGroup === item.group;
              return (
                <button
                  key={item.group}
                  onClick={() => setSelectedGroup(isSelected ? null : item.group)}
                  className={`flex items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-foreground/10 ${
                    isSelected ? "bg-foreground/15" : ""
                  }`}
                >
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: item.color,
                      boxShadow: `0 0 0 1px ${item.stroke}`,
                    }}
                  />
                  <span className="truncate">{item.label}</span>
                  <X
                    className={`ml-auto size-3 ${isSelected ? "text-muted-foreground" : "invisible"}`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        className="absolute left-3 top-3 z-20 flex border border-border/80 bg-background/90 shadow-sm backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
        aria-label="Graph viewport controls"
      >
        <Button
          onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))}
          size="icon-sm"
          variant="ghost"
          className="rounded-none border-r border-border"
          aria-label="Zoom in"
        >
          +
        </Button>
        <Button
          onClick={() => setZoom((value) => Math.max(0.4, value - 0.15))}
          size="icon-sm"
          variant="ghost"
          className="rounded-none border-r border-border"
          aria-label="Zoom out"
        >
          −
        </Button>
        <Button
          onClick={fitGraph}
          size="sm"
          variant="ghost"
          className="rounded-none border-r border-border"
        >
          Fit
        </Button>
        <Button
          onClick={resetGraph}
          size="sm"
          variant="ghost"
          className="rounded-none"
        >
          Reset
        </Button>
      </div>

      <div className="absolute left-3 top-14 z-20" aria-label="Keyboard graph navigation">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className="sr-only focus:not-sr-only focus:block focus:min-w-64 focus:border focus:border-oppulence-orange focus:bg-background focus:px-3 focus:py-2 focus:text-left focus:text-xs focus:text-primary focus:shadow-lg"
            onFocus={() => setHoveredNodeId(node.id)}
            onBlur={() => setHoveredNodeId(null)}
            onClick={() => onSelectNode?.(node.id)}
          >
            Inspect {node.ariaLabel ?? `${node.label}, ${node.group}`}
          </button>
        ))}
      </div>

      <svg
        className="h-full w-full touch-none"
        aria-hidden="true"
        focusable="false"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          handlePointerUp();
          setHoveredNodeId(null);
        }}
        onWheel={handleWheel}
      >
        <title>Relationship graph</title>
        <desc>Directional, evidence-bearing connections. Nodes are keyboard operable.</desc>
        <rect width={viewport.width} height={viewport.height} fill="transparent" />
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.55" />
          </marker>
          {Array.from(new Set(nodes.map((n) => n.color))).map((color) => (
            <filter
              key={color}
              id={`glow-${color.replace("#", "")}`}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edgeList.map((edge, index) => {
            const source = displayPositions.get(edge.source);
            const target = displayPositions.get(edge.target);
            if (!source || !target) return null;
            const sourceGroup = nodeGroupMap.get(edge.source) ?? "root";
            const targetGroup = nodeGroupMap.get(edge.target) ?? "root";
            const isActiveEdge = activeNodeId
              ? edge.source === activeNodeId || edge.target === activeNodeId
              : false;
            const isSearchEdge = searchMatchingNodes
              ? searchMatchingNodes.matches.has(edge.source) &&
                searchMatchingNodes.matches.has(edge.target)
              : false;
            const isGroupEdge = selectedGroup
              ? sourceGroup === selectedGroup && targetGroup === selectedGroup
              : false;
            let strokeOpacity = 0.4;
            let strokeWidth = 1;
            if (selectedGroup) {
              strokeOpacity = isGroupEdge ? 0.6 : 0.05;
              strokeWidth = isGroupEdge ? 1.5 : 1;
            } else if (searchMatchingNodes) {
              strokeOpacity = isSearchEdge ? 0.6 : 0.05;
              strokeWidth = isSearchEdge ? 1.5 : 1;
            } else if (activeNodeId) {
              strokeOpacity = isActiveEdge ? 0.8 : 0.1;
              strokeWidth = isActiveEdge ? 2 : 1;
            }
            const activeNode = activeNodeId ? nodes.find((n) => n.id === activeNodeId) : null;
            const stroke = isActiveEdge && activeNode ? activeNode.color : "#333";
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
            const pathD = `M${source.x},${source.y}A${dr},${dr} 0 0,1 ${target.x},${target.y}`;
            return (
              <g key={edge.id ?? `${edge.source}-${edge.target}-${index}`}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={strokeOpacity}
                  strokeWidth={strokeWidth}
                  markerEnd={edge.directed ? "url(#graph-arrow)" : undefined}
                  style={{
                    transition: reducedMotion
                      ? undefined
                      : "stroke 0.2s, stroke-opacity 0.2s, stroke-width 0.2s",
                  }}
                />
                {isActiveEdge && edge.label ? (
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2 - 5}
                    textAnchor="middle"
                    className="pointer-events-none text-[9px]"
                    style={{ fill: "currentColor" }}
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {nodes.map((node) => {
            const pos = displayPositions.get(node.id);
            if (!pos) return null;
            const nodeGroup = node.group || "root";
            const isConnected = connectedNodes ? connectedNodes.has(node.id) : true;
            const isSearchMatch = searchMatchingNodes
              ? searchMatchingNodes.matches.has(node.id)
              : true;
            const isDirectMatch = searchMatchingNodes
              ? searchMatchingNodes.directMatches.has(node.id)
              : false;
            const isGroupMatch = selectedGroup ? nodeGroup === selectedGroup : true;
            const isPrimary =
              activeNodeId === node.id || isDirectMatch || (selectedGroup && isGroupMatch);
            let nodeOpacity = 1;
            if (selectedGroup) {
              nodeOpacity = isGroupMatch ? 1 : 0.1;
            } else if (searchMatchingNodes) {
              if (isDirectMatch) {
                nodeOpacity = 1;
              } else if (isSearchMatch) {
                nodeOpacity = 0.5;
              } else {
                nodeOpacity = 0.1;
              }
            } else if (activeNodeId) {
              nodeOpacity = isConnected ? 1 : 0.3;
            }
            const glowFilterId = `glow-${node.color.replace("#", "")}`;
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x} ${pos.y})`}
                className="cursor-pointer"
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() => setHoveredNodeId(null)}
                onPointerDown={(event) => startDragNode(event, node.id)}
                style={{ transition: reducedMotion ? undefined : "opacity 0.2s", outline: "none" }}
                opacity={nodeOpacity}
              >
                <circle
                  r={30}
                  fill={node.color}
                  opacity={isPrimary ? 0.4 : 0}
                  style={{ transition: reducedMotion ? undefined : "opacity 0.2s" }}
                />
                {node.shape === "diamond" ? (
                  <polygon
                    points={`0,-${node.radius} ${node.radius},0 0,${node.radius} -${node.radius},0`}
                    fill={node.color}
                    stroke={isPrimary ? node.stroke : "#0a0a0a"}
                    strokeWidth={isPrimary ? 3 : 2}
                    filter={isPrimary ? `url(#${glowFilterId})` : undefined}
                  />
                ) : node.shape === "square" || node.shape === "pill" ? (
                  <rect
                    x={node.shape === "pill" ? -node.radius * 1.4 : -node.radius}
                    y={-node.radius}
                    width={node.shape === "pill" ? node.radius * 2.8 : node.radius * 2}
                    height={node.radius * 2}
                    rx={node.shape === "pill" ? node.radius : 3}
                    fill={node.color}
                    stroke={isPrimary ? node.stroke : "#0a0a0a"}
                    strokeWidth={isPrimary ? 3 : 2}
                    filter={isPrimary ? `url(#${glowFilterId})` : undefined}
                  />
                ) : (
                  <circle
                    r={node.radius}
                    fill={node.color}
                    stroke={isPrimary ? node.stroke : "#0a0a0a"}
                    strokeWidth={isPrimary ? 3 : 2}
                    filter={isPrimary ? `url(#${glowFilterId})` : undefined}
                  />
                )}
                {node.icon ? (
                  <foreignObject
                    x={-10}
                    y={-10}
                    width={20}
                    height={20}
                    className="pointer-events-none overflow-visible"
                  >
                    <div className="flex size-5 items-center justify-center text-white">
                      {node.icon}
                    </div>
                  </foreignObject>
                ) : null}
                {isPrimary || node.priorityLabel || (nodes.length <= 18 && zoom >= 0.8) || zoom >= 1.75 ? (
                  <text
                    y={node.radius + 16}
                    textAnchor="middle"
                    className="text-[10px]"
                    style={{ fill: "#9ca3af", fontWeight: 500 }}
                  >
                    {node.label}
                  </text>
                ) : null}
                {node.badge && (isPrimary || zoom >= 1.35) ? (
                  <text y={node.radius + 28} textAnchor="middle" className="text-[8px]" style={{ fill: node.stroke }}>
                    {node.badge}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {showMiniMap && nodes.length ? (
        <svg
          viewBox="-320 -240 640 480"
          className="pointer-events-none absolute bottom-3 right-3 z-20 h-24 w-36 border border-border/80 bg-background/90 shadow-sm backdrop-blur"
          aria-label="Graph minimap"
        >
          {edgeList.map((edge, index) => {
            const source = displayPositions.get(edge.source);
            const target = displayPositions.get(edge.target);
            if (!source || !target) return null;
            return (
              <line
                key={edge.id ?? index}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="currentColor"
                strokeOpacity="0.15"
                strokeWidth="2"
              />
            );
          })}
          {nodes.map((node) => {
            const position = displayPositions.get(node.id);
            return position ? (
              <circle
                key={node.id}
                cx={position.x}
                cy={position.y}
                r={node.id === selectedNodeId ? 8 : 5}
                fill={node.color}
              />
            ) : null;
          })}
        </svg>
      ) : null}

      <div
        className="absolute left-3 top-14 z-10"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="relative flex items-center">
          <Search className="absolute left-3 size-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-64 bg-background/90 pl-9 pr-20 shadow-sm backdrop-blur"
          />
          <div className="absolute right-3 flex items-center gap-2">
            {searchMatchingNodes && (
              <span className="text-xs text-muted-foreground">
                {searchMatchingNodes.directMatches.size}
              </span>
            )}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
