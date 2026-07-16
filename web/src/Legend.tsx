import type { EntityType, Stats } from "./types";
import { TYPE_COLORS, TYPE_LABELS } from "./theme";

const TYPES: EntityType[] = [
  "person",
  "company",
  "institution",
  "school",
  "channel",
];

export default function Legend({
  stats,
  visibleTotal,
}: {
  stats: Stats | null;
  visibleTotal: number;
}) {
  return (
    <div className="legend">
      <div className="l-title">Tipler</div>
      {TYPES.map((t) => (
        <div className="l-row" key={t}>
          <span className="swatch" style={{ background: TYPE_COLORS[t] }} />
          <span>{TYPE_LABELS[t]}</span>
          {stats && <span className="cnt">{stats.byType[t] ?? 0}</span>}
        </div>
      ))}
      <div className="l-foot">
        <span>Görünen</span>
        <span>
          <b>{visibleTotal}</b>
          {stats ? ` / ${stats.total}` : ""} düğüm
        </span>
      </div>
      {stats && (
        <div className="l-foot" style={{ marginTop: 4, paddingTop: 4 }}>
          <span>İlişki</span>
          <span>
            <b>{stats.edgeCount}</b> kenar
          </span>
        </div>
      )}
    </div>
  );
}
