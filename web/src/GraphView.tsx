import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import type { GraphData, GraphNode } from "./types";
import { TYPE_COLORS, statusColor } from "./theme";

interface Link {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string | null;
  kind: "relation" | "mention";
}

interface Props {
  data: GraphData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusSignal: number; // bump to re-fit
  focusNodeId: string | null; // pan/zoom to this node
}

function id(n: string | GraphNode): string {
  return typeof n === "string" ? n : n.id;
}

export default function GraphView({
  data,
  selectedId,
  onSelect,
  focusSignal,
  focusNodeId,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNode, Link> | undefined>(
    undefined
  );
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lastClick = useRef<{ id: string; t: number } | null>(null);

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

  // neighbor adjacency + degree range
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
      const span = maxDeg - minDeg || 1;
      const t = (n.degree - minDeg) / span;
      return 4 + t * 7; // 4..11
    },
    [minDeg, maxDeg]
  );

  // spread the layout a bit for readable labels
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge");
    if (charge) charge.strength(-260).distanceMax(600);
    const link = fg.d3Force("link");
    if (link) link.distance(90);
    fg.d3ReheatSimulation();
  }, [data]);

  // fit on data / signal change
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const t = setTimeout(() => fg.zoomToFit(700, 140), 600);
    return () => clearTimeout(t);
  }, [focusSignal, data]);

  // pan/zoom to a specific node
  useEffect(() => {
    if (!focusNodeId) return;
    const fg = fgRef.current;
    const node = data.nodes.find((n) => n.id === focusNodeId);
    if (!fg || !node) return;
    const t = setTimeout(() => {
      if (node.x != null && node.y != null) {
        fg.centerAt(node.x, node.y, 700);
        fg.zoom(3.2, 700);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [focusNodeId, data]);

  const handleClick = useCallback(
    (node: GraphNode) => {
      const now = Date.now();
      const lc = lastClick.current;
      if (lc && lc.id === node.id && now - lc.t < 300) {
        // double click -> zoom
        const fg = fgRef.current;
        if (fg && node.x != null && node.y != null) {
          fg.centerAt(node.x, node.y, 600);
          fg.zoom(4, 600);
        }
        lastClick.current = null;
        return;
      }
      lastClick.current = { id: node.id, t: now };
      onSelect(node.id);
    },
    [onSelect]
  );

  return (
    <div ref={hostRef} className="graph-host fade-in">
      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        d3VelocityDecay={0.28}
        nodeRelSize={5}
        nodeVal={(n) => {
          const r = radiusFor(n as GraphNode);
          return (r * r) / 25;
        }}
        onNodeHover={(n) => setHoverId(n ? (n as GraphNode).id : null)}
        onNodeClick={(n) => handleClick(n as GraphNode)}
        onBackgroundClick={() => onSelect(null)}
        linkColor={(l) => {
          const link = l as Link;
          const active =
            focusSet &&
            (focusSet.has(id(link.source)) || focusSet.has(id(link.target)));
          const isFocusEdge =
            focusId &&
            (id(link.source) === focusId || id(link.target) === focusId);
          if (focusSet && !isFocusEdge) {
            return link.kind === "mention"
              ? "rgba(120,140,170,0.05)"
              : "rgba(120,140,170,0.07)";
          }
          if (isFocusEdge)
            return link.kind === "mention"
              ? "rgba(150,175,210,0.35)"
              : "rgba(120,170,230,0.7)";
          void active;
          return link.kind === "mention"
            ? "rgba(120,140,170,0.14)"
            : "rgba(120,150,190,0.28)";
        }}
        linkWidth={(l) => {
          const link = l as Link;
          const isFocusEdge =
            focusId &&
            (id(link.source) === focusId || id(link.target) === focusId);
          if (isFocusEdge) return link.kind === "mention" ? 1 : 1.8;
          return link.kind === "mention" ? 0.5 : 1;
        }}
        linkLineDash={(l) =>
          (l as Link).kind === "mention" ? [3, 3] : null
        }
        linkCanvasObjectMode={() => "after"}
        linkCanvasObject={(l, ctx, scale) => {
          const link = l as Link & {
            source: GraphNode;
            target: GraphNode;
          };
          if (!link.label) return;
          const isFocusEdge =
            focusId &&
            (id(link.source) === focusId || id(link.target) === focusId);
          if (!isFocusEdge || scale < 0.6) return;
          const s = link.source;
          const t = link.target;
          if (s.x == null || t.x == null) return;
          const mx = (s.x + t.x!) / 2;
          const my = (s.y! + t.y!) / 2;
          const fontSize = 10.5 / scale;
          ctx.font = `${fontSize}px -apple-system, sans-serif`;
          const w = ctx.measureText(link.label).width;
          const pad = 3 / scale;
          ctx.fillStyle = "rgba(12,18,32,0.92)";
          ctx.fillRect(
            mx - w / 2 - pad,
            my - fontSize / 2 - pad,
            w + pad * 2,
            fontSize + pad * 2
          );
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#c9d6ec";
          ctx.fillText(link.label, mx, my);
        }}
        nodeCanvasObject={(n, ctx, scale) => {
          const node = n as GraphNode;
          if (node.x == null || node.y == null) return;
          const r = radiusFor(node);
          const dim = focusSet != null && !focusSet.has(node.id);
          const isSel = node.id === selectedId;
          const isHover = node.id === hoverId;
          const color = TYPE_COLORS[node.type] ?? "#8aa0c0";
          const ring = statusColor(node.status);

          ctx.globalAlpha = dim ? 0.16 : 1;

          // status ring
          if (ring) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 2.4, 0, Math.PI * 2);
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = ring;
            ctx.stroke();
          }

          // selection halo
          if (isSel) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(91,168,245,0.9)";
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }

          // body
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          if (isHover || isSel) {
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.stroke();
          }

          // label (constant on-screen size)
          const showLabel = scale > 0.85 || isSel || isHover;
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
            ctx.fillStyle = "rgba(8,12,22,0.72)";
            ctx.fillRect(
              node.x - w / 2 - padX,
              ly - padY,
              w + padX * 2,
              fontSize + padY * 2
            );
            ctx.fillStyle = isSel || isHover ? "#eef4ff" : "#b6c4dc";
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
          ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
          ctx.fill();
        }}
      />
    </div>
  );
}
