import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode } from "./types";
import { TYPE_COLORS, TYPE_LABELS } from "./theme";
import { matchScore } from "./normalize";
import { IconSearch } from "./icons";

interface Props {
  nodes: GraphNode[];
  view: "graph" | "list";
  onView: (v: "graph" | "list") => void;
  onPick: (id: string) => void;
  searchRef: React.RefObject<HTMLInputElement>;
}

export default function TopBar({
  nodes,
  view,
  onView,
  onPick,
  searchRef,
}: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    return nodes
      .map((n) => ({ n, s: matchScore(q, n.name) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((r) => r.n);
  }, [q, nodes]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (n: GraphNode) => {
    onPick(n.id);
    setOpen(false);
    setQ("");
    searchRef.current?.blur();
  };

  return (
    <div className="topbar">
      <div className="logo">
        <span>Outpost</span>
        <span className="dot">.</span>
        <span className="sub">outreach ağı</span>
      </div>

      <div className="search" ref={boxRef}>
        <span className="ico">
          <IconSearch size={16} />
        </span>
        <input
          ref={searchRef}
          value={q}
          placeholder="Ara — kişi, kurum, kanal..."
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              pick(results[active]);
            } else if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
              setOpen(false);
            }
          }}
        />
        {!q && <span className="kbd">/</span>}
        {open && q && (
          <div className="search-results">
            {results.length === 0 ? (
              <div className="empty">Eşleşen düğüm yok</div>
            ) : (
              results.map((n, i) => (
                <div
                  key={n.id}
                  className={`row ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(n)}
                >
                  <span
                    className="swatch"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: TYPE_COLORS[n.type],
                    }}
                  />
                  <span className="name">{n.name}</span>
                  <span className="meta">{TYPE_LABELS[n.type]}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="viewtoggle">
        <button
          className={view === "graph" ? "on" : ""}
          onClick={() => onView("graph")}
        >
          Graf
        </button>
        <button
          className={view === "list" ? "on" : ""}
          onClick={() => onView("list")}
        >
          Liste
        </button>
      </div>
    </div>
  );
}
