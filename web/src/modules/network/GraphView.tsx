import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import type { EntityType, GraphData, GraphNode, Status } from "@/core/types";
import type { ThemeName } from "@/core/theme";
import { typeColors, statusColors } from "@/core/theme";
import type { Physics } from "@/core/physics";

interface Link {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string | null;
  kind: "relation" | "mention";
}

interface Props {
  data: GraphData;
  theme: ThemeName;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusNodeId: string | null;
  fitSignal: number;
  physics: Physics;
  hubSet: Set<string>;
  hubThreshold: number | null;
}

function id(n: string | GraphNode): string {
  return typeof n === "string" ? n : n.id;
}

const CANVAS_DARK = "#0e0e10";
const CANVAS_LIGHT = "#f6f6f7";

export default function GraphView({
  data,
  theme,
  selectedId,
  onSelect,
  focusNodeId,
  fitSignal,
  physics,
  hubSet,
  hubThreshold,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNode, Link> | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverInTimer = useRef<number | null>(null);
  const hoverOutTimer = useRef<number | null>(null);
  const pendingHover = useRef<string | null>(null);
  const settledOnce = useRef(false);

  const tc = useMemo(() => typeColors(theme), [theme]);
  const sc = useMemo(() => statusColors(theme), [theme]);
  const canvasBg = theme === "light" ? CANVAS_LIGHT : CANVAS_DARK;

  // resize observer
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: data.nodes,
      links: data.edges.map((e) => ({
        source: id(e.source),
        target: id(e.target),
        label: e.label,
        kind: e.kind,
      })) as Link[],
    }),
    [data]
  );

  const { neighbors, minDeg, maxDeg } = useMemo(() => {
    const nb = new Map<string, Set<string>>();
    for (const n of data.nodes) nb.set(n.id, new Set());
    for (const e of data.edges) {
      const s = id(e.source);
      const t = id(e.target);
      nb.get(s)?.add(t);
      nb.get(t)?.add(s);
    }
    let mn = Infinity;
    let mx = 0;
    for (const n of data.nodes) {
      mn = Math.min(mn, n.degree);
      mx = Math.max(mx, n.degree);
    }
    if (!isFinite(mn)) mn = 0;
    return { neighbors: nb, minDeg: mn, maxDeg: mx };
  }, [data]);

  const focusId = hoverId ?? selectedId;
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const s = new Set<string>([focusId]);
    for (const nb of neighbors.get(focusId) ?? []) s.add(nb);
    return s;
  }, [focusId, neighbors]);

  const radiusFor = useCallback(
    (n: GraphNode) => {
      const cap = hubThreshold ?? maxDeg;
      const d = Math.min(n.degree, cap);
      const span = (cap - minDeg) || 1;
      const t = Math.max(0, (d - minDeg) / span);
      let r = 3.4 + Math.sqrt(t) * 6.6;
      if (hubSet.has(n.id)) r *= 0.62; // hub damping
      return r;
    },
    [minDeg, maxDeg, hubSet, hubThreshold]
  );

  // ---- physics application ----
  const applyForces = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge");
    if (charge) {
      charge.strength(-physics.charge);
      // full-range repulsion: capping distanceMax made far nodes ignore each
      // other and collapsed the layout into ring/arc shells (Tuna repro)
      charge.distanceMax(Infinity);
    }
    const link = fg.d3Force("link");
    if (link) link.distance(physics.linkDistance);
    // gravity via x/y centering
    const fx = fg.d3Force("x");
    const fy = fg.d3Force("y");
    if (fx) fx.strength(physics.gravity);
    if (fy) fy.strength(physics.gravity);
    const collide = fg.d3Force("collide");
    if (collide) {
      collide.radius((n: GraphNode) => radiusFor(n) * physics.collide + 1);
    }
  }, [physics, radiusFor]);

  // register x/y + collide forces once graph exists
  const registerForces = useCallback(async () => {
    const fg = fgRef.current;
    if (!fg) return;
    const d3 = await import("d3-force-3d");
    if (!fg.d3Force("x")) fg.d3Force("x", d3.forceX(0));
    if (!fg.d3Force("y")) fg.d3Force("y", d3.forceY(0));
    if (!fg.d3Force("collide")) fg.d3Force("collide", d3.forceCollide());
    applyForces();
  }, [applyForces]);

  useEffect(() => {
    registerForces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // reheat on physics change (unless frozen)
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    applyForces();
    if (physics.frozen) {
      for (const n of data.nodes) {
        n.fx = n.x;
        n.fy = n.y;
      }
    } else {
      for (const n of data.nodes) {
        n.fx = undefined;
        n.fy = undefined;
      }
      fg.d3ReheatSimulation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics]);

  // data change → let the sim resettle, refit once on engine stop
  // (no eager timed zoomToFit here: it double-yanked the viewport)
  useEffect(() => {
    settledOnce.current = false;
  }, [data]);

  // explicit fit request
  useEffect(() => {
    if (fitSignal === 0) return;
    fgRef.current?.zoomToFit(600, 70);
  }, [fitSignal]);

  // pan/zoom to a node
  useEffect(() => {
    if (!focusNodeId) return;
    const fg = fgRef.current;
    const node = data.nodes.find((n) => n.id === focusNodeId);
    if (!fg || !node) return;
    const t = window.setTimeout(() => {
      if (node.x != null && node.y != null) {
        fg.centerAt(node.x, node.y, 650);
        fg.zoom(3.0, 650);
      }
    }, 160);
    return () => window.clearTimeout(t);
  }, [focusNodeId, data]);

  // ---- delayed / sticky hover ----
  const clearTimers = () => {
    if (hoverInTimer.current) window.clearTimeout(hoverInTimer.current);
    if (hoverOutTimer.current) window.clearTimeout(hoverOutTimer.current);
    hoverInTimer.current = null;
    hoverOutTimer.current = null;
  };
  const onNodeHover = useCallback((n: GraphNode | null) => {
    const nid = n ? n.id : null;
    pendingHover.current = nid;
    if (nid) {
      if (hoverOutTimer.current) {
        window.clearTimeout(hoverOutTimer.current);
        hoverOutTimer.current = null;
      }
      if (hoverInTimer.current) window.clearTimeout(hoverInTimer.current);
      hoverInTimer.current = window.setTimeout(() => {
        setHoverId(pendingHover.current);
      }, 80);
    } else {
      if (hoverInTimer.current) {
        window.clearTimeout(hoverInTimer.current);
        hoverInTimer.current = null;
      }
      if (hoverOutTimer.current) window.clearTimeout(hoverOutTimer.current);
      hoverOutTimer.current = window.setTimeout(() => {
        setHoverId(null);
      }, 150);
    }
  }, []);
  useEffect(() => () => clearTimers(), []);

  const handleClick = useCallback(
    (node: GraphNode) => {
      onSelect(node.id);
    },
    [onSelect]
  );

  // big graphs need the extra ticks to actually converge; 160 froze the
  // layout mid-expansion on ~1.9k nodes
  const cooldownTicks = physics.frozen
    ? 0
    : data.nodes.length > 900
    ? 320
    : 220;

  const dimAlpha = theme === "light" ? 0.12 : 0.14;
  const inkFocus = theme === "light" ? "#111114" : "#f0f0f2";
  const inkDim = theme === "light" ? "#5a5a62" : "#8a8a92";
  const labelBg =
    theme === "light" ? "rgba(246,246,247,0.82)" : "rgba(14,14,16,0.78)";
  const selHalo =
    theme === "light" ? "rgba(40,40,48,0.85)" : "rgba(232,232,238,0.9)";
  const nodeStroke =
    theme === "light" ? "rgba(20,20,24,0.55)" : "rgba(255,255,255,0.85)";
  const edgeBase =
    theme === "light" ? "60,60,68" : "150,150,160";

  return (
    <div ref={hostRef} className="graph-host fade-in">
      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={graphData}
        backgroundColor={canvasBg}
        cooldownTicks={cooldownTicks}
        warmupTicks={data.nodes.length > 900 ? 80 : 0}
        onNodeDragEnd={(n) => {
          // release after drag so an accidental pull doesn't pin the node
          // forever; when frozen, leave it pinned at its new spot
          if (!physics.frozen) {
            const node = n as GraphNode;
            node.fx = undefined;
            node.fy = undefined;
          }
        }}
        d3VelocityDecay={physics.velocityDecay}
        d3AlphaDecay={0.035}
        nodeRelSize={5}
        onEngineStop={() => {
          if (settledOnce.current) return;
          settledOnce.current = true;
          const fg = fgRef.current;
          if (fg && !focusNodeId) fg.zoomToFit(600, 70);
        }}
        nodeVal={(n) => {
          const r = radiusFor(n as GraphNode);
          return (r * r) / 25;
        }}
        onNodeHover={(n) => onNodeHover(n as GraphNode | null)}
        onNodeClick={(n) => handleClick(n as GraphNode)}
        onBackgroundClick={() => onSelect(null)}
        linkColor={(l) => {
          const link = l as Link;
          const isFocusEdge =
            focusId &&
            (id(link.source) === focusId || id(link.target) === focusId);
          if (focusSet && !isFocusEdge) return `rgba(${edgeBase},0.05)`;
          if (isFocusEdge)
            return theme === "light"
              ? "rgba(40,40,48,0.55)"
              : "rgba(220,220,228,0.6)";
          const hub =
            hubSet.has(id(link.source)) || hubSet.has(id(link.target));
          const a = hub ? 0.045 : link.kind === "mention" ? 0.11 : 0.2;
          return `rgba(${edgeBase},${a})`;
        }}
        linkWidth={(l) => {
          const link = l as Link;
          const isFocusEdge =
            focusId &&
            (id(link.source) === focusId || id(link.target) === focusId);
          if (isFocusEdge) return 1.6;
          return link.kind === "mention" ? 0.5 : 0.8;
        }}
        linkLineDash={(l) => ((l as Link).kind === "mention" ? [3, 3] : null)}
        nodeCanvasObject={(n, ctx, scale) => {
          const node = n as GraphNode;
          if (node.x == null || node.y == null) return;
          const r = radiusFor(node);
          const dim = focusSet != null && !focusSet.has(node.id);
          const isSel = node.id === selectedId;
          const isHover = node.id === hoverId;
          const isHub = hubSet.has(node.id);
          const color = tc[node.type as EntityType] ?? "#8a8a92";
          const ring = node.status ? sc[node.status as Status] : null;

          ctx.globalAlpha = dim ? dimAlpha : 1;

          if (ring) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2.4, 0, Math.PI * 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = ring;
            ctx.stroke();
          }

          if (isSel) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
            ctx.strokeStyle = selHalo;
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          if (isHover || isSel) {
            ctx.lineWidth = 1.3;
            ctx.strokeStyle = nodeStroke;
            ctx.stroke();
          }

          // label culling: priority for selected/hover/focus/hub; otherwise
          // only sufficiently-connected nodes past a zoom threshold.
          const inFocus = focusSet != null && focusSet.has(node.id);
          const degOk = node.degree >= 3;
          const showLabel =
            isSel ||
            isHover ||
            inFocus ||
            (isHub && scale > 0.7) ||
            (scale > 1.4 && degOk) ||
            scale > 2.6;
          if (showLabel && !dim) {
            const fontSize = 12 / scale;
            ctx.font = `${
              isSel || isHover ? "600 " : ""
            }${fontSize}px -apple-system, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            const padX = 4 / scale;
            const padY = 2 / scale;
            const ly = node.y + r + 4 / scale;
            const w = ctx.measureText(node.name).width;
            ctx.fillStyle = labelBg;
            ctx.fillRect(
              node.x - w / 2 - padX,
              ly - padY,
              w + padX * 2,
              fontSize + padY * 2
            );
            ctx.fillStyle = isSel || isHover || inFocus ? inkFocus : inkDim;
            ctx.fillText(node.name, node.x, ly);
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          const node = n as GraphNode;
          if (node.x == null || node.y == null) return;
          const r = radiusFor(node);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2); // generous hit radius
          ctx.fill();
        }}
      />
    </div>
  );
}
