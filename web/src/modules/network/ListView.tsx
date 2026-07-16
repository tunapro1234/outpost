import { useMemo, useState } from "react";
import type { EntityListItem, EntityType, Status } from "@/core/types";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  TYPE_COLORS,
  TYPE_LABELS,
} from "@/core/theme";
import { api } from "@/core/api";

type SortKey = "name" | "type" | "subtype" | "status" | "score" | "city" | "degree";

interface Props {
  items: EntityListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}

const TYPES: EntityType[] = [
  "person",
  "company",
  "institution",
  "school",
  "channel",
];

export default function ListView({
  items,
  selectedId,
  onSelect,
  onChanged,
}: Props) {
  const [sort, setSort] = useState<SortKey>("score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<EntityType>("person");
  const [newName, setNewName] = useState("");

  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "name":
          cmp = a.name.localeCompare(b.name, "tr");
          break;
        case "type":
          cmp = TYPE_LABELS[a.type].localeCompare(TYPE_LABELS[b.type], "tr");
          break;
        case "subtype":
          cmp = (a.subtype ?? "").localeCompare(b.subtype ?? "", "tr");
          break;
        case "status":
          cmp = (a.status ?? "").localeCompare(b.status ?? "");
          break;
        case "city":
          cmp = (a.city ?? "").localeCompare(b.city ?? "", "tr");
          break;
        case "degree":
          cmp = a.degree - b.degree;
          break;
        default:
          cmp = (a.score ?? -Infinity) - (b.score ?? -Infinity);
      }
      return order === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [items, sort, order]);

  const th = (key: SortKey, label: string, num = false) => (
    <th
      onClick={() => {
        if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
        else {
          setSort(key);
          setOrder(num ? "desc" : "asc");
        }
      }}
      style={num ? { textAlign: "right" } : undefined}
    >
      {label}
      {sort === key && <span className="arrow">{order === "asc" ? "▲" : "▼"}</span>}
    </th>
  );

  const create = async () => {
    if (!newName.trim()) return;
    const ent = await api.createEntity({ type: newType, name: newName.trim() });
    setNewName("");
    setShowNew(false);
    onChanged();
    onSelect(ent.id);
  };

  return (
    <div className="listwrap">
      <div className="list-head">
        <h2>Entities</h2>
        <span className="count">{sorted.length} records</span>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={() => setShowNew((s) => !s)}
        >
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

      <table className="grid">
        <thead>
          <tr>
            {th("name", "Name")}
            {th("type", "Type")}
            {th("subtype", "Subtype")}
            {th("status", "Status")}
            {th("score", "Score", true)}
            {th("city", "City")}
            {th("degree", "Connections", true)}
            <th>Mail</th>
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
              <td>
                <span className="type-tag">
                  <span
                    className="swatch"
                    style={{ background: TYPE_COLORS[it.type] }}
                  />
                  {TYPE_LABELS[it.type]}
                </span>
              </td>
              <td className="muted">{it.subtype ?? "—"}</td>
              <td>
                {it.status ? (
                  <span className="status-tag">
                    <span
                      className="ring"
                      style={{
                        background: STATUS_COLORS[it.status as Status],
                      }}
                    />
                    {STATUS_LABELS[it.status as Status]}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="num">{it.score != null ? it.score : "—"}</td>
              <td className="muted">{it.city ?? "—"}</td>
              <td className="num">{it.degree}</td>
              <td className="muted">{it.mail ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
