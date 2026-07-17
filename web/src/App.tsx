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
import OverviewView from "@/modules/overview/OverviewView";
import AssistantDrawer from "@/modules/assistant/AssistantDrawer";
import ControlToast from "@/components/ControlToast";
import { connectControl, type ControlCommand } from "@/core/control";
import { IconAssistant } from "@/core/icons";
import { api, setWorkspace as configureWorkspace } from "@/core/api";
import type {
  EntityListItem,
  Facets,
  GraphData,
  GraphNode,
  MailItem,
  ReachStats,
  WorkspaceInfo,
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
import { useRoute, navigate, entityPath, viewPath } from "@/core/router";

const EMPTY: GraphData = { nodes: [], edges: [] };
const WORKSPACE_STORAGE_KEY = "outpost.workspace";

const TITLES: Record<NavKey, string> = {
  overview: "Overview",
  network: "Network",
  reach: "Reach",
  agents: "Agents",
  integrations: "Integrations",
  profile: "Profile",
};

function loadTheme(): ThemeName {
  const t = localStorage.getItem("outpost.theme");
  return t === "light" ? "light" : "dark";
}

export default function App() {
  const [theme, setTheme] = useState<ThemeName>(loadTheme);
  const [graphMode, setGraphMode] = useState<"graph" | "list">("graph");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("outpost.sidebarCollapsed") === "1"
  );
  const [physicsOpen, setPhysicsOpen] = useState(
    () => localStorage.getItem("outpost.physicsOpen") === "1"
  );

  const route = useRoute();
  // Active view is derived from the path. On the entity page (/e/:id) we keep
  // the last visited view so the sidebar highlight stays put behind it.
  const lastViewRef = useRef<NavKey>("overview");
  if (route.name === "view") lastViewRef.current = route.key;
  const view: NavKey = route.name === "view" ? route.key : lastViewRef.current;

  const [full, setFull] = useState<GraphData>(EMPTY);
  const [facets, setFacets] = useState<Facets>(() => deriveFacets([]));
  const [entityList, setEntityList] = useState<EntityListItem[]>([]);
  const [mails, setMails] = useState<MailItem[] | null>(null);
  const [reachStats, setReachStats] = useState<ReachStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [workspace, setWorkspaceState] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [controlToast, setControlToast] = useState<string | null>(null);
  const controlToastTimer = useRef<number | null>(null);
  const controlHandler = useRef<(command: ControlCommand) => void>(() => {});

  const [filters, setFiltersState] = useState<FilterState>(loadFilters);
  const [physics, setPhysicsState] = useState<Physics>(loadPhysics);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Choose the workspace before issuing any scoped API request. A persisted
  // choice wins only while it still exists; otherwise use the backend default
  // flag and finally the first selectable record.
  useEffect(() => {
    let alive = true;
    api.workspaces().then((list) => {
      if (!alive) return;
      const all = list ?? [];
      const selectable = all.filter((w) => !w.comingSoon);
      const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY);
      const chosen =
        selectable.find((w) => w.id === stored) ??
        selectable.find((w) => w.default) ??
        selectable[0];

      if (!chosen) {
        if (stored) localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        setError("No available workspace was returned by the server");
        setLoaded(true);
        return;
      }

      configureWorkspace(chosen.id);
      localStorage.setItem(WORKSPACE_STORAGE_KEY, chosen.id);
      setWorkspaces(all);
      setWorkspaceState(chosen.id);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---- assistant (right drawer, every viewer) ----
  // The single workspace assistant surface — everyone (owner included) talks to
  // their personal agent here. Opened from the right-edge FAB, the Overview
  // prompt bar, or ⌘/Ctrl+J. `assistantSeed` carries a pending prompt-bar
  // message the drawer auto-sends on open; `assistantReplyKey` bumps when a
  // reply finishes so Overview can refetch its (possibly rearranged) dashboard.
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantSeed, setAssistantSeed] = useState<string | null>(null);
  const [assistantReplyKey, setAssistantReplyKey] = useState(0);

  const openAssistant = useCallback(() => {
    setAssistantOpen(true);
  }, []);

  const submitAssistant = useCallback((text: string) => {
    setAssistantSeed(text);
    setAssistantOpen(true);
  }, []);

  const changeWorkspace = useCallback(
    (id: string) => {
      if (id === workspace) return true;
      const next = workspaces.find((w) => w.id === id && !w.comingSoon);
      if (!next) return false;
      configureWorkspace(next.id);
      localStorage.setItem(WORKSPACE_STORAGE_KEY, next.id);
      setAssistantOpen(false);
      setSelectedId(null);
      setFocusNodeId(null);
      setWorkspaceState(next.id);
      return true;
    },
    [workspace, workspaces]
  );

  const showControlToast = useCallback((message: string) => {
    if (controlToastTimer.current !== null) {
      window.clearTimeout(controlToastTimer.current);
    }
    setControlToast(message);
    controlToastTimer.current = window.setTimeout(() => {
      setControlToast(null);
      controlToastTimer.current = null;
    }, 3_500);
  }, []);

  useEffect(() => () => {
    if (controlToastTimer.current !== null) {
      window.clearTimeout(controlToastTimer.current);
    }
  }, []);

  const applyControlCommand = useCallback((command: ControlCommand) => {
    switch (command.action) {
      case "navigate":
        navigate(command.path);
        showControlToast(`⌁ agent: opened ${command.path}`);
        break;
      case "open-entity":
        if (command.ws && !changeWorkspace(command.ws)) {
          showControlToast(`⌁ agent: workspace ${command.ws} is unavailable`);
          break;
        }
        navigate(entityPath(command.id));
        showControlToast(`⌁ agent: opened ${entityPath(command.id)}`);
        break;
      case "set-workspace":
        showControlToast(changeWorkspace(command.ws)
          ? `⌁ agent: selected workspace ${command.ws}`
          : `⌁ agent: workspace ${command.ws} is unavailable`);
        break;
      case "set-theme":
        setTheme(command.theme);
        showControlToast(`⌁ agent: set theme ${command.theme}`);
        break;
      case "toast":
        showControlToast(`⌁ agent: ${command.message}`);
        break;
    }
  }, [changeWorkspace, showControlToast]);
  controlHandler.current = applyControlCommand;

  const controlReady = workspace !== null;
  useEffect(() => {
    if (!controlReady) return;
    return connectControl((command) => controlHandler.current(command));
  }, [controlReady]);

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
    if (!workspace) return;
    let alive = true;
    setLoaded(false);
    setFull(EMPTY);
    setEntityList([]);
    setMails(null);
    setReachStats(null);
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
                role: m.role ?? null,
                closeness: m.closeness ?? null,
                hook: m.hook ?? null,
                mailSource: m.mail_source ?? null,
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
  }, [workspace, refreshKey]);

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    Promise.all([api.mails(), api.reachStats()])
      .then(([items, stats]) => {
        if (alive) {
          setMails(items);
          setReachStats(stats);
        }
      })
      .catch(() => {
        if (alive) {
          setMails(null);
          setReachStats(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [workspace, refreshKey]);

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
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setAssistantOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (assistantOpen) setAssistantOpen(false);
        else if (!typing) {
          if (filters.egoId) setFilters({ ...filters, egoId: null });
          else if (selectedId) setSelectedId(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, filters, setFilters, assistantOpen]);

  const gotoNode = useCallback((id: string) => {
    if (window.location.pathname !== viewPath("network")) navigate(viewPath("network"));
    setSelectedId(id);
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

  // first org each entity is connected to (for the People list preset)
  const orgByEntity = useMemo(() => {
    const ORG = new Set(["company", "institution", "school", "channel"]);
    const type = new Map(full.nodes.map((n) => [n.id, n]));
    const map = new Map<string, { id: string; name: string }>();
    for (const e of full.edges) {
      if (e.kind !== "relation") continue;
      const s = typeof e.source === "string" ? e.source : e.source.id;
      const t = typeof e.target === "string" ? e.target : e.target.id;
      const sn = type.get(s);
      const tn = type.get(t);
      if (sn?.type === "person" && tn && ORG.has(tn.type) && !map.has(s))
        map.set(s, { id: tn.id, name: tn.name });
      if (tn?.type === "person" && sn && ORG.has(sn.type) && !map.has(t))
        map.set(t, { id: sn.id, name: sn.name });
    }
    return map;
  }, [full]);

  const listItems: EntityListItem[] = useMemo(
    () =>
      result.nodes.map((n) => {
        const org = orgByEntity.get(n.id);
        return {
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
          role: n.role ?? null,
          closeness: n.closeness ?? null,
          hook: n.hook ?? null,
          mail_source: n.mailSource ?? null,
          connected_org: org?.name ?? null,
          connected_org_id: org?.id ?? null,
        };
      }),
    [result, orgByEntity]
  );

  const openFull = useCallback((id: string) => {
    navigate(entityPath(id));
  }, []);

  const egoNode = filters.egoId
    ? full.nodes.find((n) => n.id === filters.egoId)
    : null;

  const isNetwork = view === "network";

  const navigateHome = useCallback((k: NavKey) => {
    navigate(viewPath(k));
  }, []);

  // Assistant lives at layout level so it is reachable from every view. The
  // edge FAB is suppressed while another right rail (entity panel) owns that
  // edge — the drawer stays reachable via ⌘J and the FAB returns on Esc/close.
  const renderAssistant = (showFab: boolean) => (
    <>
      {showFab && !assistantOpen && (
        <button
          className="copilot-fab"
          onClick={openAssistant}
          title="Assistant — ⌘J"
          aria-label="Open assistant"
        >
          <IconAssistant size={18} />
          <span className="copilot-fab-label">Assistant</span>
        </button>
      )}
      {assistantOpen && (
        <AssistantDrawer
          key={workspace ?? undefined}
          seed={assistantSeed}
          onSeedConsumed={() => setAssistantSeed(null)}
          onReplyComplete={() => setAssistantReplyKey((k) => k + 1)}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </>
  );

  if (!workspace) {
    return (
      <div className="app">
        <div className="center-msg">
          <div>{error ?? "Loading workspace…"}</div>
        </div>
        <ControlToast message={controlToast} />
      </div>
    );
  }

  // ---- full entity page route ----
  if (route.name === "entity") {
    return (
      <div className="app">
        <Sidebar
          active={view}
          onNavigate={navigateHome}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          workspace={workspace}
          workspaces={workspaces}
          onWorkspaceChange={changeWorkspace}
        />
        <div className="main" key={workspace}>
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
        {renderAssistant(true)}
        <ControlToast message={controlToast} />
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        active={view}
        onNavigate={navigateHome}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        workspace={workspace}
        workspaces={workspaces}
        onWorkspaceChange={changeWorkspace}
      />

      <div className="main" key={workspace}>
        <TopBar
          title={TITLES[view]}
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

          {view === "overview" && (
            <OverviewView
              theme={theme}
              mails={mails}
              onOpenEntity={openFull}
              onNavigate={navigateHome}
              onAssistantSubmit={submitAssistant}
              assistantReplyKey={assistantReplyKey}
            />
          )}
          {view === "reach" && (
            <ReachView
              mails={mails}
              stats={reachStats}
              entities={entityList}
              onOpenEntity={openFull}
            />
          )}
          {view === "agents" && <GatherView />}
          {view === "integrations" && <IntegrationsView />}
          {view === "profile" && <ProfileView />}

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
      {renderAssistant(!(selectedId && isNetwork))}
      <ControlToast message={controlToast} />
    </div>
  );
}
