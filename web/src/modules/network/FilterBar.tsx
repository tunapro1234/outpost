import { useEffect, useRef, useState } from "react";
import type { EntityType, Facets } from "@/core/types";
import type { ThemeName } from "@/core/theme";
import {
  STATUS_LABELS,
  STATUS_ORDER,
  TYPE_LABELS,
  TYPE_ORDER,
  statusColors,
  typeColors,
} from "@/core/theme";
import type { FilterState, Preset } from "@/core/filters";
import {
  DEFAULT_FILTERS,
  cityDisplayName,
  isDirty,
  subtypeKey,
} from "@/core/filters";

interface Props {
  theme: ThemeName;
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  facets: Facets;
  typeCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  presets: Preset[];
  onSavePreset: (name: string) => void;
  onApplyPreset: (p: Preset) => void;
  onDeletePreset: (name: string) => void;
}

interface Chip {
  key: string;
  label: string;
  clear: () => void;
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export default function FilterBar(props: Props) {
  const {
    theme,
    filters: f,
    setFilters,
    facets,
    typeCounts,
    statusCounts,
    presets,
    onSavePreset,
    onApplyPreset,
    onDeletePreset,
  } = props;
  const tc = typeColors(theme);
  const sc = statusColors(theme);
  const [popOpen, setPopOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [queryInput, setQueryInput] = useState(f.q);
  const barRef = useRef<HTMLDivElement>(null);

  const set = (patch: Partial<FilterState>) => setFilters({ ...f, ...patch });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setPopOpen(false);
        setPresetOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setQueryInput(f.q);
  }, [f.q]);

  useEffect(() => {
    if (queryInput === f.q) return;
    const timer = window.setTimeout(() => {
      setFilters({ ...f, q: queryInput });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [queryInput, f, setFilters]);

  // ---- active filter chips ----
  const chips: Chip[] = [];
  if (f.types.length)
    chips.push({
      key: "types",
      label:
        "Type: " +
        f.types.map((t) => TYPE_LABELS[t]).slice(0, 2).join(", ") +
        (f.types.length > 2 ? ` +${f.types.length - 2}` : ""),
      clear: () => set({ types: [] }),
    });
  if (f.subtypes.length)
    chips.push({
      key: "subtypes",
      label:
        "Subtype: " +
        f.subtypes
          .map((s) => s.split("::")[1])
          .slice(0, 2)
          .join(", ") +
        (f.subtypes.length > 2 ? ` +${f.subtypes.length - 2}` : ""),
      clear: () => set({ subtypes: [] }),
    });
  if (f.statuses.length || f.noStatus)
    chips.push({
      key: "status",
      label:
        "Status: " +
        [...f.statuses.map((s) => STATUS_LABELS[s]), ...(f.noStatus ? ["No status"] : [])]
          .slice(0, 2)
          .join(", ") +
        (f.statuses.length + (f.noStatus ? 1 : 0) > 2 ? " +" : ""),
      clear: () => set({ statuses: [], noStatus: false }),
    });
  if (f.scoreMin != null || f.scoreMax != null || !f.includeUnscored) {
    const parts: string[] = [];
    if (f.scoreMin != null && f.scoreMax != null)
      parts.push(`${f.scoreMin}–${f.scoreMax}`);
    else if (f.scoreMin != null) parts.push(`≥${f.scoreMin}`);
    else if (f.scoreMax != null) parts.push(`≤${f.scoreMax}`);
    if (!f.includeUnscored) parts.push("scored");
    chips.push({
      key: "score",
      label: "Score " + parts.join(" · "),
      clear: () =>
        set({ scoreMin: null, scoreMax: null, includeUnscored: true }),
    });
  }
  if (f.degreeMin != null || f.degreeMax != null || f.hideIsolated) {
    const parts: string[] = [];
    if (f.degreeMin != null && f.degreeMax != null)
      parts.push(`${f.degreeMin}–${f.degreeMax}`);
    else if (f.degreeMin != null) parts.push(`≥${f.degreeMin}`);
    else if (f.degreeMax != null) parts.push(`≤${f.degreeMax}`);
    if (f.hideIsolated) parts.push("no isolated");
    chips.push({
      key: "degree",
      label: "Degree " + parts.join(" · "),
      clear: () =>
        set({ degreeMin: null, degreeMax: null, hideIsolated: false }),
    });
  }
  if (f.cities.length)
    chips.push({
      key: "cities",
      label:
        "City: " +
        f.cities.map((c) => cityDisplayName(facets, c)).slice(0, 2).join(", ") +
        (f.cities.length > 2 ? ` +${f.cities.length - 2}` : ""),
      clear: () => set({ cities: [] }),
    });
  if (f.mail !== "any" || f.mailSources.length)
    chips.push({
      key: "mail",
      label:
        "Mail: " +
        (f.mail !== "any" ? f.mail : "") +
        (f.mailSources.length ? ` ${f.mailSources.join(", ")}` : ""),
      clear: () => set({ mail: "any", mailSources: [] }),
    });
  if (f.closenessMin > 0 || f.closenessMax < 5)
    chips.push({
      key: "closeness",
      label: `Closeness ${f.closenessMin}–${f.closenessMax}`,
      clear: () => set({ closenessMin: 0, closenessMax: 5 }),
    });
  if (!f.showRelation)
    chips.push({
      key: "rel",
      label: "Relations off",
      clear: () => set({ showRelation: true }),
    });
  if (f.showMention)
    chips.push({
      key: "men",
      label: "Mentions on",
      clear: () => set({ showMention: false }),
    });
  if (f.hubHide)
    chips.push({
      key: "hub",
      label: "Hubs hidden",
      clear: () => set({ hubHide: false }),
    });

  const cityKeys = Object.entries(facets.cities)
    .filter(([k]) => k !== "__display")
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 14);
  const mailSourceKeys = Object.keys(facets.mail_sources);
  const maxDeg = facets.degree.max || 1;

  return (
    <div className="filterbar" ref={barRef}>
      <div className="fb-search">
        <span className="fb-funnel">⧩</span>
        <input
          value={queryInput}
          placeholder="Filter by text…"
          onChange={(e) => setQueryInput(e.target.value)}
        />
      </div>

      <div className="fb-chips">
        {chips.map((c) => (
          <span key={c.key} className="fb-chip">
            {c.label}
            <button className="fb-chip-x" onClick={c.clear}>
              ✕
            </button>
          </span>
        ))}
      </div>

      <div className="fb-add-wrap">
        <button
          className={`fb-add ${popOpen ? "on" : ""}`}
          onClick={() => {
            setPopOpen((v) => !v);
            setPresetOpen(false);
          }}
        >
          + Filter
        </button>
        {popOpen && (
          <div className="fb-pop">
            <div className="fb-pop-scroll">
              <div className="np-label">Type</div>
              <div className="np-chips">
                {TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    className={`np-chip ${f.types.includes(t) ? "on" : ""}`}
                    onClick={() => set({ types: toggle(f.types, t) })}
                  >
                    <span className="sw" style={{ background: tc[t] }} />
                    {TYPE_LABELS[t]}
                    <span className="cnt">{typeCounts[t] ?? 0}</span>
                  </button>
                ))}
              </div>

              {Object.keys(facets.subtypes).length > 0 && (
                <>
                  <div className="np-label">Subtype</div>
                  <div className="np-subtypes">
                    {TYPE_ORDER.filter((t) => facets.subtypes[t]).map((t) => (
                      <div key={t} className="np-subgroup">
                        <div className="np-subgroup-head">
                          <span className="sw" style={{ background: tc[t] }} />
                          {TYPE_LABELS[t]}
                        </div>
                        <div className="np-chips">
                          {Object.entries(facets.subtypes[t] ?? {})
                            .sort((a, b) => b[1] - a[1])
                            .map(([st, cnt]) => {
                              const key = subtypeKey(t as EntityType, st);
                              return (
                                <button
                                  key={key}
                                  className={`np-chip sm ${
                                    f.subtypes.includes(key) ? "on" : ""
                                  }`}
                                  onClick={() =>
                                    set({ subtypes: toggle(f.subtypes, key) })
                                  }
                                >
                                  {st}
                                  <span className="cnt">{cnt}</span>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="np-label">Status</div>
              <div className="np-chips">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    className={`np-chip sm ${
                      f.statuses.includes(s) ? "on" : ""
                    }`}
                    onClick={() => set({ statuses: toggle(f.statuses, s) })}
                  >
                    <span className="ring" style={{ background: sc[s] }} />
                    {STATUS_LABELS[s]}
                    <span className="cnt">{statusCounts[s] ?? 0}</span>
                  </button>
                ))}
                <button
                  className={`np-chip sm ${f.noStatus ? "on" : ""}`}
                  onClick={() => set({ noStatus: !f.noStatus })}
                >
                  No status
                </button>
              </div>

              <div className="np-label">Score</div>
              <div className="np-range">
                <input
                  type="number"
                  className="np-num"
                  placeholder="min"
                  value={f.scoreMin ?? ""}
                  onChange={(e) =>
                    set({
                      scoreMin: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <span className="np-dash">–</span>
                <input
                  type="number"
                  className="np-num"
                  placeholder="max"
                  value={f.scoreMax ?? ""}
                  onChange={(e) =>
                    set({
                      scoreMax: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <label className="np-check">
                  <input
                    type="checkbox"
                    checked={f.includeUnscored}
                    onChange={(e) => set({ includeUnscored: e.target.checked })}
                  />
                  unscored
                </label>
              </div>

              <div className="np-label">
                Degree <span className="np-hint">(connections)</span>
              </div>
              <div className="np-range">
                <input
                  type="number"
                  className="np-num"
                  placeholder="min"
                  value={f.degreeMin ?? ""}
                  onChange={(e) =>
                    set({
                      degreeMin: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <span className="np-dash">–</span>
                <input
                  type="number"
                  className="np-num"
                  placeholder="max"
                  value={f.degreeMax ?? ""}
                  onChange={(e) =>
                    set({
                      degreeMax: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <label className="np-check">
                  <input
                    type="checkbox"
                    checked={f.hideIsolated}
                    onChange={(e) => set({ hideIsolated: e.target.checked })}
                  />
                  hide isolated
                </label>
              </div>

              <div className="np-label">Edge type</div>
              <div className="np-chips">
                <button
                  className={`np-chip sm ${f.showRelation ? "on" : ""}`}
                  onClick={() => set({ showRelation: !f.showRelation })}
                >
                  Relation
                </button>
                <button
                  className={`np-chip sm ${f.showMention ? "on" : ""}`}
                  onClick={() => set({ showMention: !f.showMention })}
                >
                  Mention
                </button>
              </div>

              <div className="np-label">Hub damping</div>
              <div className="np-row">
                <input
                  type="range"
                  min={5}
                  max={maxDeg}
                  step={1}
                  value={f.hubThreshold ?? facets.degree.p99}
                  onChange={(e) => set({ hubThreshold: Number(e.target.value) })}
                />
                <span className="np-val">
                  ≥{f.hubThreshold ?? facets.degree.p99}
                </span>
              </div>
              <label className="np-check">
                <input
                  type="checkbox"
                  checked={f.hubHide}
                  onChange={(e) => set({ hubHide: e.target.checked })}
                />
                hide hubs
              </label>

              {cityKeys.length > 0 && (
                <>
                  <div className="np-label">City</div>
                  <div className="np-chips">
                    {cityKeys.map(([ck, cnt]) => (
                      <button
                        key={ck}
                        className={`np-chip sm ${
                          f.cities.includes(ck) ? "on" : ""
                        }`}
                        onClick={() => set({ cities: toggle(f.cities, ck) })}
                      >
                        {cityDisplayName(facets, ck)}
                        <span className="cnt">{cnt as number}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="np-label">Mail</div>
              <div className="np-chips">
                {(["any", "has", "none"] as const).map((m) => (
                  <button
                    key={m}
                    className={`np-chip sm ${f.mail === m ? "on" : ""}`}
                    onClick={() => set({ mail: m })}
                  >
                    {m}
                  </button>
                ))}
                {mailSourceKeys.map((s) => (
                  <button
                    key={s}
                    className={`np-chip sm ${
                      f.mailSources.includes(s) ? "on" : ""
                    }`}
                    onClick={() =>
                      set({ mailSources: toggle(f.mailSources, s) })
                    }
                  >
                    {s}
                    <span className="cnt">{facets.mail_sources[s]}</span>
                  </button>
                ))}
              </div>

              <div className="np-label">Closeness (person)</div>
              <div className="np-range">
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={f.closenessMin}
                  onChange={(e) =>
                    set({
                      closenessMin: Math.min(Number(e.target.value), f.closenessMax),
                    })
                  }
                />
                <input
                  type="range"
                  min={0}
                  max={5}
                  value={f.closenessMax}
                  onChange={(e) =>
                    set({
                      closenessMax: Math.max(Number(e.target.value), f.closenessMin),
                    })
                  }
                />
                <span className="np-val">
                  {f.closenessMin}–{f.closenessMax}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {isDirty(f) && (
        <button
          className="fb-clear"
          onClick={() =>
            setFilters({ ...DEFAULT_FILTERS, hubThreshold: f.hubThreshold })
          }
        >
          Clear all
        </button>
      )}

      <div className="fb-preset-wrap">
        <button
          className={`fb-preset-btn ${presetOpen ? "on" : ""}`}
          onClick={() => {
            setPresetOpen((v) => !v);
            setPopOpen(false);
          }}
        >
          Saved views ▾
        </button>
        {presetOpen && (
          <div className="fb-pop preset">
            {presets.map((p) => (
              <div key={p.name} className="fb-preset-row">
                <button
                  className="fb-preset-apply"
                  onClick={() => {
                    onApplyPreset(p);
                    setPresetOpen(false);
                  }}
                >
                  {p.name}
                  {p.builtin && <span className="fb-preset-tag">default</span>}
                </button>
                {!p.builtin && (
                  <button
                    className="fb-preset-del"
                    title="Delete"
                    onClick={() => onDeletePreset(p.name)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <div className="fb-preset-save">
              <input
                className="np-input sm"
                placeholder="Save current as…"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && presetName.trim()) {
                    onSavePreset(presetName.trim());
                    setPresetName("");
                  }
                }}
              />
              <button
                className="np-btn"
                disabled={!presetName.trim()}
                onClick={() => {
                  if (presetName.trim()) {
                    onSavePreset(presetName.trim());
                    setPresetName("");
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
