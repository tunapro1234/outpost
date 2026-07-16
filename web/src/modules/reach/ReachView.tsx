import { useMemo, useState } from "react";
import type { MailItem } from "@/core/types";
import { trNormalize } from "@/core/normalize";

interface Props {
  mails: MailItem[] | null; // null = endpoint not available yet
  onPickPerson: (id: string) => void;
}

type Dir = "all" | "out" | "in";

export default function ReachView({ mails, onPickPerson }: Props) {
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<Dir>("all");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const src = mails ?? [];
    const nq = trNormalize(q);
    let out = src.filter((m) => {
      if (dir !== "all" && m.direction !== dir) return false;
      if (nq) {
        const hay = trNormalize(`${m.person_name} ${m.summary} ${m.raw}`);
        if (!hay.includes(nq)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      const da = a.date ?? "";
      const db = b.date ?? "";
      const cmp = da.localeCompare(db);
      return asc ? cmp : -cmp;
    });
    return out;
  }, [mails, q, dir, asc]);

  if (mails === null) {
    return (
      <div className="view-pad">
        <div className="empty-state">
          <div className="es-title">Mail service coming online</div>
          <div className="es-sub">
            The <code>/api/mails</code> endpoint is not live yet. Once it ships,
            mail records will be listed here.
          </div>
        </div>
      </div>
    );
  }

  if (mails.length === 0) {
    return (
      <div className="view-pad">
        <div className="empty-state">
          <div className="es-title">No mail records yet</div>
          <div className="es-sub">
            As entries are added to the <code>## Mailler</code> section of
            person notes, they will appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-pad mails">
      <div className="mails-bar">
        <input
          className="np-input"
          style={{ maxWidth: 320 }}
          placeholder="Search mail — person, subject, content"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="seg">
          {(["all", "out", "in"] as Dir[]).map((d) => (
            <button
              key={d}
              className={dir === d ? "on" : ""}
              onClick={() => setDir(d)}
            >
              {d === "all" ? "All" : d === "out" ? "→ Outbound" : "← Inbound"}
            </button>
          ))}
        </div>
        <span className="mails-count">{rows.length} records</span>
      </div>

      <table className="grid mails-grid">
        <thead>
          <tr>
            <th className="sortable" onClick={() => setAsc((a) => !a)}>
              Date <span className="arrow">{asc ? "▲" : "▼"}</span>
            </th>
            <th>Direction</th>
            <th>Person</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={`${m.person_id}-${i}`}>
              <td className="mono">{m.date ?? "—"}</td>
              <td>
                <span className={`dir-tag ${m.direction}`}>
                  {m.direction === "out"
                    ? "→ out"
                    : m.direction === "in"
                    ? "← in"
                    : "•"}
                </span>
              </td>
              <td>
                <button
                  className="link-btn"
                  onClick={() => onPickPerson(m.person_id)}
                >
                  {m.person_name}
                </button>
              </td>
              <td className="summary">{m.summary || m.raw}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
