import { useCallback, useEffect, useRef, useState } from "react";
import GraphView from "./GraphView";
import TopBar from "./TopBar";
import FilterStrip from "./FilterStrip";
import Legend from "./Legend";
import EntityPanel from "./EntityPanel";
import ListView from "./ListView";
import { api } from "./api";
import type { GraphData, GraphFilters, Stats } from "./types";

const EMPTY: GraphData = { nodes: [], edges: [] };

export default function App() {
  const [filters, setFilters] = useState<GraphFilters>({
    types: [],
    statuses: [],
    minScore: null,
    q: "",
  });
  const [data, setData] = useState<GraphData>(EMPTY);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [focusSignal] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // initial ?select=<id>
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sel = p.get("select");
    if (sel) {
      setSelectedId(sel);
      setFocusNodeId(sel);
    }
  }, []);

  // load graph on filter change
  useEffect(() => {
    let alive = true;
    api
      .graph(filters)
      .then((g) => {
        if (!alive) return;
        setData(g);
        setLoaded(true);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message ?? "Graf yüklenemedi");
        setData(EMPTY);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [filters, refreshKey]);

  // stats once (+ on data mutation)
  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [refreshKey]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (!typing && selectedId) setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  const gotoNode = useCallback((id: string) => {
    setSelectedId(id);
    setFocusNodeId(id);
    setView("graph");
    // re-trigger focus effect even if same id
    setFocusNodeId((prev) => (prev === id ? id : id));
  }, []);

  const onPick = useCallback((id: string) => {
    setSelectedId(id);
    setFocusNodeId(null);
    setTimeout(() => setFocusNodeId(id), 0);
    setView("graph");
  }, []);

  const onDataChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="app">
      <TopBar
        nodes={data.nodes}
        view={view}
        onView={setView}
        onPick={onPick}
        searchRef={searchRef}
      />
      <FilterStrip filters={filters} onChange={setFilters} stats={stats} />

      <div className="stage">
        {view === "graph" ? (
          <>
            {loaded && data.nodes.length === 0 ? (
              <div className="center-msg">
                <div>Eşleşen düğüm yok</div>
                <div style={{ fontSize: 12 }}>Filtreleri gevşet</div>
              </div>
            ) : (
              <GraphView
                data={data}
                selectedId={selectedId}
                onSelect={setSelectedId}
                focusSignal={focusSignal}
                focusNodeId={focusNodeId}
              />
            )}
            <Legend stats={stats} visibleTotal={data.nodes.length} />
            <div className="hint">
              <span className="kbd">/</span> ara
              <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
              <span className="kbd">Esc</span> kapat
              <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
              çift tık yakınlaş
            </div>
          </>
        ) : (
          <ListView
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onChanged={onDataChanged}
            refreshKey={refreshKey}
          />
        )}

        {selectedId && (
          <EntityPanel
            id={selectedId}
            onClose={() => setSelectedId(null)}
            onGoto={gotoNode}
            onChanged={onDataChanged}
          />
        )}
      </div>

      {error && (
        <div className="err-toast">
          {error}
          {api.mock ? "" : " — server 127.0.0.1:3002 çalışıyor mu?"}
        </div>
      )}
    </div>
  );
}
