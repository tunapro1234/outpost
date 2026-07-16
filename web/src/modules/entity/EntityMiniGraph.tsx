import { useMemo } from "react";
import GraphView from "@/modules/network/GraphView";
import type { GraphData, GraphNode } from "@/core/types";
import type { ThemeName } from "@/core/theme";
import { DEFAULT_PHYSICS } from "@/core/physics";

interface Props {
  data: GraphData; // full graph
  centerId: string;
  theme: ThemeName;
  onSelect: (id: string) => void;
}

function endId(n: string | GraphNode): string {
  return typeof n === "string" ? n : n.id;
}

// 1-hop neighbourhood subgraph rendered with the real GraphView in a compact
// container. Reuses the exact canvas renderer so the ego view reads like a
// zoomed-in slice of the network.
export default function EntityMiniGraph({ data, centerId, theme, onSelect }: Props) {
  const sub = useMemo<GraphData>(() => {
    const keep = new Set<string>([centerId]);
    for (const e of data.edges) {
      const s = endId(e.source);
      const t = endId(e.target);
      if (s === centerId) keep.add(t);
      if (t === centerId) keep.add(s);
    }
    const nodes = data.nodes.filter((n) => keep.has(n.id));
    const edges = data.edges.filter(
      (e) => keep.has(endId(e.source)) && keep.has(endId(e.target))
    );
    return { nodes, edges };
  }, [data, centerId]);

  if (sub.nodes.length <= 1) {
    return (
      <div className="ep-mini-empty">No connections mapped yet.</div>
    );
  }

  return (
    <div className="ep-mini">
      <GraphView
        data={sub}
        theme={theme}
        selectedId={centerId}
        onSelect={(id) => id && onSelect(id)}
        focusNodeId={null}
        fitSignal={0}
        physics={{ ...DEFAULT_PHYSICS, charge: 160, linkDistance: 46 }}
        hubSet={new Set()}
        hubThreshold={null}
      />
    </div>
  );
}
