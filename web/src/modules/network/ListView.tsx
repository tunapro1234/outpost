import { useEffect, useMemo, useRef, useState } from "react";
import type { EntityListItem, EntityType, Status } from "@/core/types";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  TYPE_COLORS,
  TYPE_LABELS,
} from "@/core/theme";
import { api } from "@/core/api";

type ColKey =
  | "type"
  | "subtype"
  | "status"
  | "score"
  | "city"
  | "degree"
  | "mail"
  | "mail_status"
  | "mail_count"
  | "last_mail_date"
  | "last_mail_direction"
  | "role"
  | "connected_org"
  | "closeness";

type SortKey = "name" | ColKey;
type GroupKey = "none" | "city" | "subtype" | "status";
type PresetId = "all" | "company" | "person" | "institution" | "school" | "channel";

interface SortSpec {
  key: SortKey;
  order: "asc" | "desc";
}

interface Props {
  items: EntityListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFull: (id: string) => void;
  onChanged: () => void;
}

const TYPES: EntityType[] = [
  "person",
  "company",
  "institution",
  "school",
  "channel",
];

// canonical column registry (order used for header + popover)
const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "type", label: "Type" },
  { key: "subtype", label: "Subtype" },
  { key: "role", label: "Role" },
  { key: "connected_org", label: "Connected org" },
  { key: "status", label: "Status" },
  { key: "score", label: "Score", num: true },
  { key: "closeness", label: "Closeness", num: true },
  { key: "city", label: "City" },
  { key: "degree", label: "Connections", num: true },
  { key: "mail_status", label: "Mail" },
  { key: "mail", label: "Mail address" },
  { key: "mail_count", label: "Mails", num: true },
  { key: "last_mail_date", label: "Last mail" },
  { key: "last_mail_direction", label: "Dir" },
];
const PRESETS: { id: PresetId; label: string; type: EntityType | null; cols: ColKey[] }[] = [
  {
    id: "all",
    label: "All",
    type: null,
    cols: ["type", "subtype", "status", "score", "city", "degree", "mail_count", "last_mail_date"],
  },
  {
    id: "company",
    label: "Companies",
    type: "company",
    cols: ["subtype", "city", "score", "mail_status", "mail_count", "last_mail_date", "degree"],
  },
  {
    id: "person",
    label: "People",
    type: "person",
    cols: ["role", "connected_org", "closeness", "mail_status", "degree"],
  },
  {
    id: "institution",
    label: "Institutions",
    type: "institution",
    cols: ["subtype", "city", "score", "mail_status", "mail_count", "last_mail_date", "degree"],
  },
  {
    id: "school",
    label: "Schools",
    type: "school",
    cols: ["subtype", "city", "score", "mail_status", "mail_count", "last_mail_date", "degree"],
  },
  {
    id: "channel",
    label: "Channels",
    type: "channel",
    cols: ["subtype", "degree"],
  },
];

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "city", label: "City" },
  { key: "subtype", label: "Subtype" },
  { key: "status", label: "Status" },
];

interface SavedView {
  name: string;
  preset: PresetId;
  grouping: GroupKey;
  cols: ColKey[];
  sorts: SortSpec[];
}

const LS_STATE = "outpost.list.state.v2";
const LS_VIEWS = "outpost.list.views.v2";

function loadState(): {
  preset: PresetId;
  grouping: GroupKey;
  cols: ColKey[];
  sorts: SortSpec[];
} | null {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(LS_VIEWS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function cmpFor(key: SortKey, a: EntityListItem, b: EntityListItem): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, "tr");
    case "type":
      return TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type], "tr");
    case "subtype":
      return (a.subtype ?? "").localeCompare(b.subtype ?? "", "tr");
    case "role":
      return (a.role ?? "").localeCompare(b.role ?? "", "tr");
    case "connected_org":
      return (a.connected_org ?? "").localeCompare(b.connected_org ?? "", "tr");
    case "status":
      return (a.status ?? "").localeCompare(b.status ?? "");
    case "city":
      return (a.city ?? "").localeCompare(b.city ?? "", "tr");
    case "degree":
      return a.degree - b.degree;
    case "score":
      return (a.score ?? -Infinity) - (b.score ?? -Infinity);
    case "closeness":
      return (a.closeness ?? -Infinity) - (b.closeness ?? -Infinity);
    case "mail":
    case "mail_status":
      return (a.mail ? 1 : 0) - (b.mail ? 1 : 0);
    case "mail_count":
      return (a.mail_count ?? 0) - (b.mail_count ?? 0);
    case "last_mail_date":
      return (a.last_mail_date ?? "").localeCompare(b.last_mail_date ?? "");
    case "last_mail_direction":
      return (a.last_mail_direction ?? "").localeCompare(
        b.last_mail_direction ?? ""
      );
    default:
      return 0;
  }
}

function groupValue(it: EntityListItem, g: GroupKey): string {
  switch (g) {
    case "city":
      return it.city || "No city";
    case "subtype":
      return it.subtype || "No subtype";
    case "status":
      return it.status ? STATUS_LABELS[it.status as Status] : "No status";
    default:
      return "";
  }
}

export default function ListView({
  items,
  selectedId,
  onSelect,
  onOpenFull,
  onChanged,
}: Props) {
  const saved = loadState();
  const [preset, setPreset] = useState<PresetId>(saved?.preset ?? "all");
  const [grouping, setGrouping] = useState<GroupKey>(saved?.grouping ?? "none");
  const [cols, setCols] = useState<ColKey[]>(
    saved?.cols ?? PRESETS[0].cols
  );
  const [sorts, setSorts] = useState<SortSpec[]>(
    saved?.sorts ?? [{ key: "score", order: "desc" }]
  );
  const [views, setViews] = useState<SavedView[]>(loadViews);

  const [colsOpen, setColsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<EntityType>("person");
  const [newName, setNewName] = useState("");
  const colsRef = useRef<HTMLDivElement>(null);
  const viewsRef = useRef<HTMLDivElement>(null);

  // persist current working state
  useEffect(() => {
    localStorage.setItem(
      LS_STATE,
      JSON.stringify({ preset, grouping, cols, sorts })
    );
  }, [preset, grouping, cols, sorts]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node))
        setColsOpen(false);
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node))
        setViewsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const applyPreset = (id: PresetId) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setCols(p.cols);
    setCollapsed(new Set());
  };

  const visible = (k: ColKey) => cols.includes(k);
  const toggleCol = (k: ColKey) => {
    setCols((prev) => {
      const next = prev.includes(k)
        ? prev.filter((x) => x !== k)
        : [...prev, k];
      return COLUMNS.map((c) => c.key).filter((c) => next.includes(c));
    });
  };

  // preset type filter (list is its own surface; graph filter stays shared)
  const presetType = PRESETS.find((p) => p.id === preset)!.type;
  const filtered = useMemo(
    () => (presetType ? items.filter((it) => it.type === presetType) : items),
    [items, presetType]
  );

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      for (const s of sorts) {
        const cmp = cmpFor(s.key, a, b);
        if (cmp !== 0) return s.order === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return arr;
  }, [filtered, sorts]);

  // grouped structure
  const groups = useMemo(() => {
    if (grouping === "none") return null;
    const map = new Map<string, EntityListItem[]>();
    for (const it of sorted) {
      const g = groupValue(it, grouping);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(it);
    }
    const arr = [...map.entries()].map(([label, its]) => ({ label, items: its }));
    arr.sort((a, b) => {
      const emptyA = a.label.startsWith("No ");
      const emptyB = b.label.startsWith("No ");
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      return b.items.length - a.items.length;
    });
    return arr;
  }, [sorted, grouping]);

  const onHeader = (key: SortKey, num: boolean, shift: boolean) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (shift) {
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { key, order: copy[idx].order === "asc" ? "desc" : "asc" };
          return copy;
        }
        return [...prev, { key, order: num ? "desc" : "asc" }];
      }
      if (idx === 0 && prev.length === 1) {
        return [{ key, order: prev[0].order === "asc" ? "desc" : "asc" }];
      }
      return [{ key, order: num ? "desc" : "asc" }];
    });
  };

  const th = (key: SortKey, label: string, num = false) => {
    const idx = sorts.findIndex((s) => s.key === key);
    const s = idx >= 0 ? sorts[idx] : null;
    return (
      <th
        onClick={(e) => onHeader(key, num, e.shiftKey)}
        style={num ? { textAlign: "right" } : undefined}
        title="Click to sort · Shift-click to add a tiebreaker"
      >
        {label}
        {s && (
          <span className="arrow">
            {s.order === "asc" ? "▲" : "▼"}
            {sorts.length > 1 && <sup className="sort-rank">{idx + 1}</sup>}
          </span>
        )}
      </th>
    );
  };

  const create = async () => {
    if (!newName.trim()) return;
    const ent = await api.createEntity({ type: newType, name: newName.trim() });
    setNewName("");
    setShowNew(false);
    onChanged();
    onSelect(ent.id);
  };

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [
      ...views.filter((v) => v.name !== name),
      { name, preset, grouping, cols, sorts },
    ];
    setViews(next);
    localStorage.setItem(LS_VIEWS, JSON.stringify(next));
    setViewName("");
  };
  const applyView = (v: SavedView) => {
    setPreset(v.preset);
    setGrouping(v.grouping);
    setCols(v.cols);
    setSorts(v.sorts);
    setCollapsed(new Set());
    setViewsOpen(false);
  };
  const deleteView = (name: string) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    localStorage.setItem(LS_VIEWS, JSON.stringify(next));
  };

  const dirText = (d?: "out" | "in" | null) =>
    d === "out" ? "→ out" : d === "in" ? "← in" : "—";

  // ---- cell render ----
  const cell = (it: EntityListItem, k: ColKey) => {
    switch (k) {
      case "type":
        return (
          <td key={k}>
            <span className="type-tag">
              <span className="swatch" style={{ background: TYPE_COLORS[it.type] }} />
              {TYPE_LABELS[it.type]}
            </span>
          </td>
        );
      case "subtype":
        return (
          <td key={k} className="muted">
            {it.subtype ?? "—"}
          </td>
        );
      case "role":
        return (
          <td key={k} className="muted">
            {it.role ?? "—"}
          </td>
        );
      case "connected_org":
        return (
          <td key={k}>
            {it.connected_org ? (
              <button
                className="cell-link"
                onClick={(e) => {
                  e.stopPropagation();
                  if (it.connected_org_id) onSelect(it.connected_org_id);
                }}
              >
                {it.connected_org}
              </button>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
        );
      case "status":
        return (
          <td key={k}>
            {it.status ? (
              <span className="status-tag">
                <span
                  className="ring"
                  style={{ background: STATUS_COLORS[it.status as Status] }}
                />
                {STATUS_LABELS[it.status as Status]}
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
        );
      case "score":
        return (
          <td key={k} className="num">
            {it.score != null ? it.score : "—"}
          </td>
        );
      case "closeness":
        return (
          <td key={k} className="num">
            {it.closeness != null ? it.closeness : "—"}
          </td>
        );
      case "city":
        return (
          <td key={k} className="muted">
            {it.city ?? "—"}
          </td>
        );
      case "degree":
        return (
          <td key={k} className="num">
            {it.degree}
          </td>
        );
      case "mail_status":
        return (
          <td key={k}>
            {it.mail ? (
              <span className="mail-yes">✓ has mail</span>
            ) : (
              <span className="mail-no">— none</span>
            )}
          </td>
        );
      case "mail":
        return (
          <td key={k} className="muted">
            {it.mail || "—"}
          </td>
        );
      case "mail_count":
        return (
          <td key={k} className="num">
            {it.mail_count ?? 0}
          </td>
        );
      case "last_mail_date":
        return (
          <td key={k} className="mono muted">
            {it.last_mail_date ?? "—"}
          </td>
        );
      case "last_mail_direction":
        return (
          <td key={k}>
            {it.last_mail_direction ? (
              <span className={`dir-tag ${it.last_mail_direction}`}>
                {dirText(it.last_mail_direction)}
              </span>
            ) : (
              <span className="muted">—</span>
            )}
          </td>
        );
      default:
        return <td key={k} />;
    }
  };

  const activeCols = COLUMNS.filter((c) => visible(c.key));
  const colSpan = activeCols.length + 2; // name + open

  const row = (it: EntityListItem) => (
    <tr
      key={it.id}
      className={it.id === selectedId ? "sel" : ""}
      onClick={() => onSelect(it.id)}
    >
      <td className="c-name">{it.name}</td>
      {activeCols.map((c) => cell(it, c.key))}
      <td className="col-open">
        <button
          className="row-open"
          title="Open full page"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFull(it.id);
          }}
        >
          →
        </button>
      </td>
    </tr>
  );

  return (
    <div className="listwrap">
      <div className="list-head">
        <h2>List</h2>
        <span className="count">{sorted.length} records</span>

        <div className="list-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset-btn ${preset === p.id ? "on" : ""}`}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="list-tools">
          <label className="group-select">
            <span>Group</span>
            <select
              value={grouping}
              onChange={(e) => {
                setGrouping(e.target.value as GroupKey);
                setCollapsed(new Set());
              }}
            >
              {GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>

          <div className="views-wrap" ref={viewsRef}>
            <button className="btn" onClick={() => setViewsOpen((o) => !o)}>
              Views ▾
            </button>
            {viewsOpen && (
              <div className="views-pop">
                {views.length === 0 ? (
                  <div className="views-empty">No saved views yet</div>
                ) : (
                  views.map((v) => (
                    <div key={v.name} className="views-row">
                      <button className="views-apply" onClick={() => applyView(v)}>
                        {v.name}
                        <span className="views-meta">
                          {PRESETS.find((p) => p.id === v.preset)?.label}
                          {v.grouping !== "none"
                            ? ` · by ${v.grouping}`
                            : ""}
                        </span>
                      </button>
                      <button
                        className="views-del"
                        title="Delete view"
                        onClick={() => deleteView(v.name)}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
                <div className="views-save">
                  <input
                    value={viewName}
                    placeholder="Save current as…"
                    onChange={(e) => setViewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveView()}
                  />
                  <button
                    className="btn primary"
                    disabled={!viewName.trim()}
                    onClick={saveView}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="cols-wrap" ref={colsRef}>
            <button className="btn" onClick={() => setColsOpen((o) => !o)}>
              Columns ▾
            </button>
            {colsOpen && (
              <div className="cols-pop">
                {COLUMNS.map((c) => (
                  <label key={c.key} className="cols-row">
                    <input
                      type="checkbox"
                      checked={visible(c.key)}
                      onChange={() => toggleCol(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button className="btn" onClick={() => setShowNew((s) => !s)}>
            + New
          </button>
        </div>
      </div>

      {showNew && (
        <div className="newform">
          <div className="field">
            <label>Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as EntityType)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>Name</label>
            <input
              value={newName}
              autoFocus
              placeholder="Enter name…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <button className="btn primary" onClick={create}>
            Create
          </button>
        </div>
      )}

      <table className="grid list-grid">
        <thead>
          <tr>
            {th("name", "Name")}
            {activeCols.map((c) => th(c.key, c.label, c.num))}
            <th className="col-open" />
          </tr>
        </thead>
        <tbody>
          {groups === null
            ? sorted.map(row)
            : groups.map((g) => {
                const isCollapsed = collapsed.has(g.label);
                return [
                  <tr key={`h-${g.label}`} className="group-row">
                    <td colSpan={colSpan}>
                      <button
                        className="group-toggle"
                        onClick={() =>
                          setCollapsed((prev) => {
                            const n = new Set(prev);
                            n.has(g.label) ? n.delete(g.label) : n.add(g.label);
                            return n;
                          })
                        }
                      >
                        <span className={`group-caret ${isCollapsed ? "c" : ""}`}>
                          ▾
                        </span>
                        <span className="group-name">{g.label}</span>
                        <span className="group-count">{g.items.length}</span>
                      </button>
                    </td>
                  </tr>,
                  ...(isCollapsed ? [] : g.items.map(row)),
                ];
              })}
        </tbody>
      </table>
    </div>
  );
}
