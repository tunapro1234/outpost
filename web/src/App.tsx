import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar, { NavKey } from "@/layout/Sidebar";
import TopBar from "@/layout/TopBar";
import FilterBar from "@/modules/network/FilterBar";
import GraphView from "@/modules/network/GraphView";
import ListView from "@/modules/network/ListView";
import EntityPanel from "@/modules/network/EntityPanel";
import PhysicsPanel from "@/modules/network/PhysicsPanel";
import LegendOverlay from "@/modules/network/LegendOverlay";
import ReachView from "@/modules/reach/ReachView";
import EntityPage from "@/modules/entity/EntityPage";
import GatherView from "@/modules/gather/GatherView";
import IntegrationsView from "@/modules/integrations/IntegrationsView";
import ProfileView from "@/modules/profile/ProfileView";
import WorkspaceView from "@/modules/workspace/WorkspaceView";
import { api } from "@/core/api";
import type {
  EntityListItem,
  Facets,
  GraphData,
  GraphNode,
  MailItem,
} from "@/core/types";
import type { ThemeName } from "@/core/theme";
import type { FilterState, Preset } from "@/core/filters";
import {
  applyFilters,
  applyPreset,
  buildAdjacency,
  deriveFacets,
  loadFilters,
  loadPresets,
  persistFilters,
  saveUserPresets,
} from "@/core/filters";
import type { Physics } from "@/core/physics";
import { loadPhysics, savePhysics } from "@/core/physics";
import { useRoute, navigate, entityPath } from "@/core/router";

const EMPTY: GraphData = { nodes: [], edges: [] };
const WORKSPACE = "probot";

const TITLES: Record<NavKey, string> = {
  network: "Network",
  reach: "Reach",
  gather: "Gather",
  integrations: "Integrations",
  profile: "Profile",
  workspace: "Workspace",
};

function loadTheme(): ThemeName {
  const t = localStorage.getItem("outpost.theme");
  return t === "light" ? "light" : "dark";
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(loadTheme);
  const [nav, setNav] = useState<NavKey>("network");
  const [graphMode, setGraphMode] = useState<"graph" | "list">("graph");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("outpost.sidebarCollapsed") === "1"
  );
  const [physicsOpen, setPhysicsOpen] = useState(
    () => localStorage.getItem("outpost.physicsOpen") === "1"
  );

  const route = useRoute();
  const [full, setFull] = useState<GraphData>(EMPTY);
  const [facets, setFacets] = useState<Facets>(() => deriveFacets([]));
  const [entityList, setEntityList] = useState<EntityListItem[]>([]);
  const [mails, setMails] = useState<MailItem[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [filters, setFiltersState] = useState<FilterState>(loadFilters);
  const [physics, setPhysicsState] = useState<Physics>(loadPhysics);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // ---- persistence side-effects ----
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("outpost.theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("outpost.sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  useEffect(() => {
    localStorage.setItem("outpost.physicsOpen", physicsOpen ? "1" : "0");
  }, [physicsOpen]);

  const setFilters = useCallback((f: FilterState) => {
    setFiltersState(f);
    persistFilters(f);
  }, []);
  const setPhysics = useCallback((p: Physics) => {
    setPhysicsState(p);
    savePhysics(p);
  }, []);

  // ---- initial ?select= ----
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sel = p.get("select");
    if (sel) {
      setSelectedId(sel);
      setFocusNodeId(sel);
    }
  }, []);

  // ---- load full data once (+ on refresh) ----
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    Promise.all([api.fullGraph(), api.entities({}), api.facets()])
      .then(([graph, list, serverFacets]) => {
        if (!alive) return;
        const meta = new Map<string, EntityListItem>();
        for (const it of list) meta.set(it.id, it);
        const nodes: GraphNode[] = graph.nodes.map((n) => {
          const m = meta.get(n.id);
          return m
            ? {
                ...n,
                city: m.city ?? null,
                mail: m.mail ?? null,
                mail_count: m.mail_count ?? 0,
                last_mail_date: m.last_mail_date ?? null,
                last_mail_direction: m.last_mail_direction ?? null,
                last_mail_from: m.last_mail_from ?? null,
              }
            : n;
        });
        setEntityList(list);
        setFull({ nodes, edges: graph.edges });
        setFacets(serverFacets ?? deriveFacets(nodes));
        setLoaded(true);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message ?? "Failed to load graph");
        setFull(EMPTY);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    api.mails().then(setMails).catch(() => setMails(null));
  }, [refreshKey]);

  // default hub threshold from facets once known
  useEffect(() => {
    if (filters.hubThreshold == null && facets.degree.p99 > 0) {
      setFiltersState((f) =>
        f.hubThreshold == null ? { ...f, hubThreshold: facets.degree.p99 } : f
      );
    }
  }, [facets, filters.hubThreshold]);

  const adjacency = useMemo(
    () => buildAdjacency(full.edges, full.nodes),
    [full]
  );
  const result = useMemo(
    () => applyFilters(full, filters, adjacency),
    [full, filters, adjacency]
  );
  const filteredData: GraphData = useMemo(
    () => ({ nodes: result.nodes, edges: result.edges }),
    [result]
  );

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tagName = (e.target as HTMLElement)?.tagName;
      const typing = tagName === "INPUT" || tagName === "TEXTAREA";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && !typing) {
        if (filters.egoId) setFilters({ ...filters, egoId: null });
        else if (selectedId) setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, filters, setFilters]);

  const gotoNode = useCallback((id: string) => {
    if (window.location.pathname !== "/") navigate("/");
    setSelectedId(id);
    setNav("network");
    setGraphMode("graph");
    setFocusNodeId(null);
    setTimeout(() => setFocusNodeId(id), 0);
  }, []);

  const onDataChanged = useCallback(() => setRefreshKey((k) => k + 1), []);

  const onApplyPreset = useCallback(
    (p: Preset) => setFilters(applyPreset(filters, p)),
    [filters, setFilters]
  );
  const onSavePreset = useCallback(
    (name: string) => {
      const next = [
        ...presets.filter((p) => p.name !== name || p.builtin),
        { name, filters: { ...filters } },
      ];
      setPresets(next);
      saveUserPresets(next);
    },
    [presets, filters]
  );
  const onDeletePreset = useCallback(
    (name: string) => {
      const next = presets.filter((p) => p.builtin || p.name !== name);
      setPresets(next);
      saveUserPresets(next);
    },
    [presets]
  );
  const onEgo = useCallback(
    (id: string) => {
      setFilters({ ...filters, egoId: id });
      setSelectedId(id);
    },
    [filters, setFilters]
  );

  const listItems: EntityListItem[] = useMemo(
    () =>
      result.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        subtype: n.subtype ?? null,
        status: n.status ?? null,
        score: n.score ?? null,
        city: n.city ?? null,
        mail: n.mail ?? null,
        degree: n.degree,
        mail_count: n.mail_count ?? 0,
        last_mail_date: n.last_mail_date ?? null,
        last_mail_direction: n.last_mail_direction ?? null,
        last_mail_from: n.last_mail_from ?? null,
      })),
    [result]
  );

  const openFull = useCallback((id: string) => {
    navigate(entityPath(id));
  }, []);

  const egoNode = filters.egoId
    ? full.nodes.find((n) => n.id === filters.egoId)
    : null;

  const isNetwork = nav === "network";

  const navigateHome = useCallback((k: NavKey) => {
    if (window.location.pathname !== "/") navigate("/");
    setNav(k);
  }, []);

  // ---- full entity page route ----
  if (route.name === "entity") {
    return (
      <div className="app">
        <Sidebar
          active={nav}
          onNavigate={navigateHome}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          workspace={WORKSPACE}
        />
        <div className="main">
          <EntityPage
            id={route.id}
            theme={theme}
            onToggleTheme={() =>
              setTheme((t) => (t === "dark" ? "light" : "dark"))
            }
            mails={mails}
            graph={full}
            onChanged={onDataChanged}
          />
        </div>
        {error && (
          <div className="err-toast">
            {error}
            {api.mock ? "" : " — is the server on 127.0.0.1:3002 running?"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        active={nav}
        onNavigate={navigateHome}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        workspace={WORKSPACE}
      />

      <div className="main">
        <TopBar
          title={TITLES[nav]}
          showGraphToggle={isNetwork}
          graphMode={graphMode}
          onGraphMode={setGraphMode}
          nodes={full.nodes}
          onPick={gotoNode}
          searchRef={searchRef}
          theme={theme}
          onToggleTheme={() =>
            setTheme((t) => (t === "dark" ? "light" : "dark"))
          }
        />

        {isNetwork && (
          <FilterBar
            theme={theme}
            filters={filters}
            setFilters={setFilters}
            facets={facets}
            typeCounts={result.typeCounts}
            statusCounts={result.statusCounts}
            presets={presets}
            onSavePreset={onSavePreset}
            onApplyPreset={onApplyPreset}
            onDeletePreset={onDeletePreset}
          />
        )}

        <div className="stage">
          {/* network layer stays mounted so nav switches don't re-simulate */}
          <div className={`net-stage ${isNetwork ? "" : "hidden"}`}>
            {isNetwork && graphMode === "graph" && (
              <div className="stage-tools right">
                <button
                  className="tool-btn"
                  title="Fit to view"
                  onClick={() => setFitSignal((s) => s + 1)}
                >
                  Fit
                </button>
                <button
                  className={`tool-btn ico ${physicsOpen ? "on" : ""}`}
                  title="Physics settings"
                  onClick={() => setPhysicsOpen((v) => !v)}
                >
                  ⚙
                </button>
              </div>
            )}

            {isNetwork && result.egoActive && egoNode && (
              <div className="ego-strip">
                <span>
                  <b>{egoNode.name}</b> · {filters.egoDepth}-hop neighborhood
                </span>
                <span className="ego-depth">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      className={filters.egoDepth === d ? "on" : ""}
                      onClick={() => setFilters({ ...filters, egoDepth: d })}
                    >
                      {d}
                    </button>
                  ))}
                </span>
                <button
                  className="ego-exit"
                  onClick={() => setFilters({ ...filters, egoId: null })}
                >
                  Exit ✕
                </button>
              </div>
            )}

            {graphMode === "graph" ? (
              loaded && filteredData.nodes.length === 0 ? (
                <div className="center-msg">
                  <div>No matching nodes</div>
                  <div style={{ fontSize: 12 }}>Loosen the filters</div>
                </div>
              ) : (
                <GraphView
                  data={filteredData}
                  theme={theme}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  focusNodeId={focusNodeId}
                  fitSignal={fitSignal}
                  physics={physics}
                  hubSet={result.hubSet}
                  hubThreshold={filters.hubThreshold}
                />
              )
            ) : (
              <ListView
                items={listItems}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpenFull={openFull}
                onChanged={onDataChanged}
              />
            )}

            {isNetwork && graphMode === "graph" && (
              <LegendOverlay
                theme={theme}
                typeCounts={result.typeCounts}
                visibleNodes={result.nodes.length}
                totalNodes={full.nodes.length}
                visibleEdges={result.edges.length}
                mentionOff={!filters.showMention}
              />
            )}

            {isNetwork && graphMode === "graph" && (
              <div className="hint">
                <span className="kbd">/</span> search
                <span className="hint-sep">·</span>
                <span className="kbd">click</span> select
                <span className="hint-sep">·</span>
                <span className="kbd">Esc</span> close
              </div>
            )}

            {isNetwork && graphMode === "graph" && physicsOpen && (
              <PhysicsPanel
                physics={physics}
                setPhysics={setPhysics}
                onClose={() => setPhysicsOpen(false)}
              />
            )}
          </div>

          {nav === "reach" && (
            <ReachView
              mails={mails}
              entities={entityList}
              onOpenEntity={openFull}
            />
          )}
          {nav === "gather" && <GatherView />}
          {nav === "integrations" && <IntegrationsView />}
          {nav === "profile" && <ProfileView />}
          {nav === "workspace" && <WorkspaceView />}

          {selectedId && isNetwork && (
            <EntityPanel
              id={selectedId}
              theme={theme}
              onClose={() => setSelectedId(null)}
              onGoto={gotoNode}
              onOpenFull={openFull}
              onChanged={onDataChanged}
              onEgo={onEgo}
              egoActive={result.egoActive && filters.egoId === selectedId}
            />
          )}
        </div>
      </div>

      {error && (
        <div className="err-toast">
          {error}
          {api.mock ? "" : " — is the server on 127.0.0.1:3002 running?"}
        </div>
      )}
    </div>
  );
}
