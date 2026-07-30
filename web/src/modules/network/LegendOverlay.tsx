import type { ThemeName } from "@/core/theme";
import {
  OUTREACH_STATE_LABELS,
  OUTREACH_STATE_ORDER,
  TYPE_ICONS,
  TYPE_LABELS,
  TYPE_ORDER,
  typeColors,
  outreachStateColors,
} from "@/core/theme";

interface Props {
  theme: ThemeName;
  typeCounts: Record<string, number>;
  visibleNodes: number;
  totalNodes: number;
  visibleEdges: number;
  mentionOff: boolean;
  colorMode: "type" | "state";
  stateCounts: Record<string, number>;
}

export default function LegendOverlay({
  theme,
  typeCounts,
  visibleNodes,
  totalNodes,
  visibleEdges,
  mentionOff,
  colorMode,
  stateCounts,
}: Props) {
  const tc = typeColors(theme);
  const oc = outreachStateColors(theme);
  return (
    <div className="legend-overlay">
      {colorMode === "type"
        ? TYPE_ORDER.map((t) => (
            <div className="lo-row" key={t}>
              <span className="sw" style={{ background: tc[t] }} />
              <span className="lo-icon" aria-hidden>{TYPE_ICONS[t]}</span>
              <span className="lo-name">{TYPE_LABELS[t]}</span>
              <span className="lo-cnt">{typeCounts[t] ?? 0}</span>
            </div>
          ))
        : OUTREACH_STATE_ORDER.map((state) => (
            <div className="lo-row" key={state}>
              <span className="sw" style={{ background: oc[state] }} />
              <span className="lo-icon lo-state-num" aria-hidden>{state}</span>
              <span className="lo-name">{OUTREACH_STATE_LABELS[state]}</span>
              <span className="lo-cnt">{stateCounts[state] ?? 0}</span>
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
