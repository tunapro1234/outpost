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
  | "mail_count"
  | "last_mail_date"
  | "last_mail_direction";

type SortKey = "name" | ColKey;

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

const COLUMNS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: "type", label: "Type" },
  { key: "subtype", label: "Subtype" },
  { key: "status", label: "Status" },
  { key: "score", label: "Score", num: true },
  { key: "city", label: "City" },
  { key: "degree", label: "Connections", num: true },
  { key: "mail", label: "Mail" },
  { key: "mail_count", label: "Mails", num: true },
  { key: "last_mail_date", label: "Last mail" },
  { key: "last_mail_direction", label: "Dir" },
];

const DEFAULT_COLS: ColKey[] = [
  "type",
  "subtype",
  "status",
  "score",
  "city",
  "degree",
  "mail_count",
  "last_mail_date",
];

const LS_COLS = "outpost.list.cols.v1";

function loadCols(): ColKey[] {
  try {
    const raw = localStorage.getItem(LS_COLS);
    if (raw) {
      const arr = JSON.parse(raw) as ColKey[];
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_COLS;
}

function cmpFor(key: SortKey, a: EntityListItem, b: EntityListItem): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, "tr");
    case "type":
      return TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type], "tr");
    case "subtype":
      return (a.subtype ?? "").localeCompare(b.subtype ?? "", "tr");
    case "status":
      return (a.status ?? "").localeCompare(b.status ?? "");
    case "city":
      return (a.city ?? "").localeCompare(b.city ?? "", "tr");
    case "degree":
      return a.degree - b.degree;
    case "score":
      return (a.score ?? -Infinity) - (b.score ?? -Infinity);
    case "mail":
      return (a.mail ?? "").localeCompare(b.mail ?? "", "tr");
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

export default function ListView({
  items,
  selectedId,
  onSelect,
  onOpenFull,
  onChanged,
}: Props) {
  const [sorts, setSorts] = useState<SortSpec[]>([
    { key: "score", order: "desc" },
  ]);
  const [cols, setCols] = useState<ColKey[]>(loadCols);
  const [colsOpen, setColsOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<EntityType>("person");
  const [newName, setNewName] = useState("");
  const colsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(LS_COLS, JSON.stringify(cols));
  }, [cols]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node))
        setColsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const visible = (k: ColKey) => cols.includes(k);

  const toggleCol = (k: ColKey) => {
    setCols((prev) => {
      const next = prev.includes(k)
        ? prev.filter((x) => x !== k)
        : [...prev, k];
      // keep canonical column order
      return COLUMNS.map((c) => c.key).filter((c) => next.includes(c));
    });
  };

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      for (const s of sorts) {
        const cmp = cmpFor(s.key, a, b);
        if (cmp !== 0) return s.order === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return arr;
  }, [items, sorts]);

  const onHeader = (key: SortKey, num: boolean, shift: boolean) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.key === key);
      if (shift) {
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = {
            key,
            order: copy[idx].order === "asc" ? "desc" : "asc",
          };
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

  const dirText = (d?: "out" | "in" | null) =>
    d === "out" ? "→ out" : d === "in" ? "← in" : "—";

  return (
    <div className="listwrap">
      <div className="list-head">
        <h2>Entities</h2>
        <span className="count">{sorted.length} records</span>
        <div className="cols-wrap" ref={colsRef} style={{ marginLeft: "auto" }}>
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
            {visible("type") && th("type", "Type")}
            {visible("subtype") && th("subtype", "Subtype")}
            {visible("status") && th("status", "Status")}
            {visible("score") && th("score", "Score", true)}
            {visible("city") && th("city", "City")}
            {visible("degree") && th("degree", "Connections", true)}
            {visible("mail") && th("mail", "Mail")}
            {visible("mail_count") && th("mail_count", "Mails", true)}
            {visible("last_mail_date") && th("last_mail_date", "Last mail")}
            {visible("last_mail_direction") &&
              th("last_mail_direction", "Dir")}
            <th className="col-open" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((it) => (
            <tr
              key={it.id}
              className={it.id === selectedId ? "sel" : ""}
              onClick={() => onSelect(it.id)}
            >
              <td className="c-name">{it.name}</td>
              {visible("type") && (
                <td>
                  <span className="type-tag">
                    <span
                      className="swatch"
                      style={{ background: TYPE_COLORS[it.type] }}
                    />
                    {TYPE_LABELS[it.type]}
                  </span>
                </td>
              )}
              {visible("subtype") && (
                <td className="muted">{it.subtype ?? "—"}</td>
              )}
              {visible("status") && (
                <td>
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
              )}
              {visible("score") && (
                <td className="num">{it.score != null ? it.score : "—"}</td>
              )}
              {visible("city") && <td className="muted">{it.city ?? "—"}</td>}
              {visible("degree") && <td className="num">{it.degree}</td>}
              {visible("mail") && <td className="muted">{it.mail || "—"}</td>}
              {visible("mail_count") && (
                <td className="num">{it.mail_count ?? 0}</td>
              )}
              {visible("last_mail_date") && (
                <td className="mono muted">{it.last_mail_date ?? "—"}</td>
              )}
              {visible("last_mail_direction") && (
                <td>
                  {it.last_mail_direction ? (
                    <span className={`dir-tag ${it.last_mail_direction}`}>
                      {dirText(it.last_mail_direction)}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              )}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
