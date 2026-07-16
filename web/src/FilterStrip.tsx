import type { EntityType, GraphFilters, Stats, Status } from "./types";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  TYPE_COLORS,
  TYPE_LABELS,
} from "./theme";

const TYPES: EntityType[] = [
  "person",
  "company",
  "institution",
  "school",
  "channel",
];

interface Props {
  filters: GraphFilters;
  onChange: (f: GraphFilters) => void;
  stats: Stats | null;
}

export default function FilterStrip({ filters, onChange, stats }: Props) {
  const toggleType = (t: EntityType) => {
    const has = filters.types.includes(t);
    onChange({
      ...filters,
      types: has ? filters.types.filter((x) => x !== t) : [...filters.types, t],
    });
  };
  const toggleStatus = (s: Status) => {
    const has = filters.statuses.includes(s);
    onChange({
      ...filters,
      statuses: has
        ? filters.statuses.filter((x) => x !== s)
        : [...filters.statuses, s],
    });
  };

  const dirty =
    filters.types.length ||
    filters.statuses.length ||
    filters.minScore != null;

  return (
    <div className="filterstrip">
      <div className="chipgroup">
        {TYPES.map((t) => {
          const on = filters.types.includes(t);
          const off = filters.types.length > 0 && !on;
          return (
            <button
              key={t}
              className={`chip ${on ? "on" : ""} ${off ? "off" : ""}`}
              onClick={() => toggleType(t)}
            >
              <span
                className="swatch"
                style={{ background: TYPE_COLORS[t] }}
              />
              {TYPE_LABELS[t]}
              {stats && (
                <span className="cnt">{stats.byType[t] ?? 0}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="strip-sep" />

      <div className="chipgroup">
        {STATUS_ORDER.map((s) => {
          const on = filters.statuses.includes(s);
          const off = filters.statuses.length > 0 && !on;
          return (
            <button
              key={s}
              className={`status-chip ${on ? "on" : ""} ${off ? "off" : ""}`}
              onClick={() => toggleStatus(s)}
              title={STATUS_LABELS[s]}
            >
              <span
                className="ring"
                style={{ background: STATUS_COLORS[s] }}
              />
              {STATUS_LABELS[s]}
            </button>
          );
        })}
      </div>

      <div className="strip-sep" />

      <div className="slider">
        <span className="strip-label">Min skor</span>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={filters.minScore ?? 0}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange({ ...filters, minScore: v === 0 ? null : v });
          }}
        />
        <span className="val">{filters.minScore ?? 0}</span>
      </div>

      {dirty ? (
        <button
          className="strip-clear"
          onClick={() =>
            onChange({ types: [], statuses: [], minScore: null, q: filters.q })
          }
        >
          Filtreleri temizle
        </button>
      ) : null}
    </div>
  );
}
