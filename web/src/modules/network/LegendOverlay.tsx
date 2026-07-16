import type { ThemeName } from "@/core/theme";
import { TYPE_LABELS, TYPE_ORDER, typeColors } from "@/core/theme";

interface Props {
  theme: ThemeName;
  typeCounts: Record<string, number>;
  visibleNodes: number;
  totalNodes: number;
  visibleEdges: number;
  mentionOff: boolean;
}

export default function LegendOverlay({
  theme,
  typeCounts,
  visibleNodes,
  totalNodes,
  visibleEdges,
  mentionOff,
}: Props) {
  const tc = typeColors(theme);
  return (
    <div className="legend-overlay">
      {TYPE_ORDER.map((t) => (
        <div className="lo-row" key={t}>
          <span className="sw" style={{ background: tc[t] }} />
          <span className="lo-name">{TYPE_LABELS[t]}</span>
          <span className="lo-cnt">{typeCounts[t] ?? 0}</span>
        </div>
      ))}
      <div className="lo-foot">
        <span>
          <b>{visibleNodes.toLocaleString("en")}</b>/
          {totalNodes.toLocaleString("en")} nodes
        </span>
        <span>
          <b>{visibleEdges.toLocaleString("en")}</b> edges
        </span>
      </div>
      <div className="lo-mention">
        <span className="dash-line" /> mention{mentionOff ? " (off)" : ""}
      </div>
    </div>
  );
}
