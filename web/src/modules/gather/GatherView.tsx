import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Agent,
  AgentRun,
  GatherKind,
  GatherOverview,
  OverviewAgent,
  StageItem,
} from "@/core/types";
import { api } from "@/core/api";
import AgentsStrip from "./AgentsStrip";

// ---- helpers -------------------------------------------------------------
function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function duration(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const TASK_DESC: Record<string, string> = {
  "scrape-classify":
    "Crawls candidate sources through the shared browser, then classifies and extracts contact details into staging.",
  "dedup-review":
    "Compares staged proposals against the vault, deciding merge / new / reject before anything lands in the network.",
  "link-discovery": "Discovers new relations between existing entities.",
};

function taskDesc(task: string): string {
  return TASK_DESC[task] ?? task;
}

// short, human status label for a card (dark + light readable)
function statusLabel(status: string | undefined, enabled: boolean): string {
  if (status === "running") return "Running";
  if (status === "error") return "Needs attention";
  if (!enabled) return "Paused";
  if (status === "ok") return "Idle";
  return "Ready";
}

// ---- tab taxonomy (SPEC-GATHER2 §1 + §3) --------------------------------
interface KindTab {
  key: GatherKind;
  label: string;
  flow: string;
}
const TABS: KindTab[] = [
  {
    key: "discover-company",
    label: "Discover Companies",
    flow: "Web search · directories → classify → stage → vault",
  },
  {
    key: "discover-person",
    label: "Discover People",
    flow: "Team pages · search → classify → stage → vault",
  },
  {
    key: "enrich",
    label: "Enrich",
    flow: "Existing entities → fill missing fields → vault",
  },
];

function stageKind(s: StageItem): GatherKind {
  return s.kind ?? "enrich"; // back-compat: unlabelled staging is enrichment
}

// ---- run status pill -----------------------------------------------------
function StatusDot({ status, enabled }: { status?: string; enabled: boolean }) {
  const cls =
    status === "running"
      ? "running"
      : status === "error"
        ? "error"
        : status === "ok"
          ? "ok"
          : enabled
            ? "idle"
            : "off";
  return <span className={`g-dot ${cls}`} title={status ?? (enabled ? "idle" : "disabled")} />;
}

// ---- mini timeline (runs sparkline) -------------------------------------
function RunTimeline({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) return null;
  const ordered = [...runs].reverse().slice(-24); // oldest → newest
  const max = Math.max(1, ...ordered.map((r) => r.items_out || 0));
  return (
    <div className="g-timeline" title="Items out per run">
      {ordered.map((r) => {
        const h = Math.max(3, Math.round(((r.items_out || 0) / max) * 30));
        return (
          <span
            key={r.id}
            className={`g-bar ${r.status}`}
            style={{ height: h }}
            title={`${r.items_out} out · ${r.staged} staged · ${r.status}`}
          />
        );
      })}
    </div>
  );
}

// ---- agent card (per-tab) -----------------------------------------------
function AgentCard({
  agent,
  ov,
  live,
  selected,
  onSelect,
  onRun,
}: {
  agent: Agent;
  ov?: OverviewAgent;
  live: boolean; // locally-triggered run in flight
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  const lr = agent.last_run;
  const status = live ? "running" : ov?.status ?? lr?.status;
  const running = status === "running";
  const currentTask = running ? ov?.currentTask : null;
  return (
    <div
      className={`g-agent ${selected ? "sel" : ""} ${running ? "live" : ""} ${
        !agent.enabled ? "paused" : ""
      }`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="g-agent-top">
        <StatusDot status={status} enabled={agent.enabled} />
        <span className="g-agent-name">{agent.name}</span>
        <span className="g-model">{agent.model}</span>
      </div>

      <div className="g-agent-meta">
        <span className={`g-agent-status ${status ?? ""} ${!agent.enabled ? "paused" : ""}`}>
          {statusLabel(status, agent.enabled)}
        </span>
        <span className="g-dot-sep">·</span>
        <span className="g-agent-kindtag">{agent.task}</span>
      </div>

      <p className="g-agent-desc">{taskDesc(agent.task)}</p>

      <div className="g-agent-foot">
        <span className="g-agent-stat">
          {running ? (
            <span className="g-run-live">
              <span className="g-spin" /> {currentTask ?? "Working…"}
            </span>
          ) : lr ? (
            <>
              <span className="g-agent-when">{timeAgo(lr.started)}</span>
              <span className="g-dot-sep">·</span>
              <span>{lr.items_out} items</span>
              <span className="g-dot-sep">·</span>
              <span>{lr.staged} staged</span>
              {lr.warnings > 0 && (
                <>
                  <span className="g-dot-sep">·</span>
                  <span className="g-warn">{lr.warnings} warn</span>
                </>
              )}
            </>
          ) : (
            <span className="g-agent-never">Not run yet</span>
          )}
        </span>
        <button
          className="g-agent-run"
          disabled={running}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          title={running ? "Run in progress" : "Run this agent now"}
        >
          {running ? "Running" : "Run now"}
        </button>
      </div>
    </div>
  );
}

export default function GatherView() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [stage, setStage] = useState<StageItem[] | null>(null);
  const [overview, setOverview] = useState<GatherOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GatherKind>("discover-company");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [running, setRunning] = useState<{ agentId: string; runId: string } | null>(
    null
  );
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api.agents(), api.stage()]);
      setAgents(a);
      setStage(s);
      setError(null);
    } catch (e) {
      setError((e as Error)?.message ?? "Failed to load gather data");
      setAgents([]);
      setStage([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // poll the live overview every 5s (SPEC-GATHER2 §3)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const ov = await api.gatherOverview();
      if (!alive) return;
      setOverview(ov);
      setOverviewLoading(false);
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // load runs for the selected agent
  useEffect(() => {
    if (!selectedId) {
      setRuns([]);
      return;
    }
    let alive = true;
    api
      .runs(selectedId)
      .then((r) => alive && setRuns(r))
      .catch(() => alive && setRuns([]));
    return () => {
      alive = false;
    };
  }, [selectedId, running]);

  // poll an active run until it ends
  useEffect(() => {
    if (!running) return;
    const tick = async () => {
      try {
        const r = await api.run(running.runId);
        if (r.ended) {
          setRunning(null);
          await load();
          api.runs(running.agentId).then(setRuns).catch(() => {});
        }
      } catch {
        /* keep polling */
      }
    };
    pollRef.current = window.setInterval(tick, 2500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [running, load]);

  const selected = agents?.find((a) => a.id === selectedId) ?? null;

  const runNow = useCallback(async (id: string) => {
    try {
      const { runId } = await api.runAgent(id);
      setRunning({ agentId: id, runId });
    } catch (e) {
      setError((e as Error)?.message ?? "Failed to start run");
    }
  }, []);

  const decide = useCallback(
    async (file: string, decision: "accept" | "reject") => {
      setBusyStage(file);
      try {
        await api.stageDecision(file, decision);
        setStage((s) => (s ? s.filter((x) => x.file !== file) : s));
      } catch (e) {
        setError((e as Error)?.message ?? "Decision failed");
      } finally {
        setBusyStage(null);
      }
    },
    []
  );

  // overview agent lookup by id (kind / live status / currentTask)
  const ovById = useMemo(() => {
    const m = new Map<string, OverviewAgent>();
    overview?.agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [overview]);

  // kind for a base agent — from overview, else enrich (back-compat)
  const agentKind = useCallback(
    (a: Agent): GatherKind => ovById.get(a.id)?.kind ?? "enrich",
    [ovById]
  );

  // staged counts per kind — prefer live overview counts, else derive from stage
  const stagedCount = useCallback(
    (k: GatherKind): number => {
      const fromOverview = overview?.counts?.[k]?.staged;
      if (typeof fromOverview === "number") return fromOverview;
      return (stage ?? []).filter((s) => stageKind(s) === k).length;
    },
    [overview, stage]
  );

  const tabAgents = useMemo(
    () => (agents ?? []).filter((a) => agentKind(a) === tab),
    [agents, agentKind, tab]
  );
  const tabStage = useMemo(
    () => (stage ?? []).filter((s) => stageKind(s) === tab),
    [stage, tab]
  );

  const renderAgentCard = (a: Agent) => (
    <AgentCard
      key={a.id}
      agent={a}
      ov={ovById.get(a.id)}
      live={running?.agentId === a.id}
      selected={selectedId === a.id}
      onSelect={() => setSelectedId(a.id)}
      onRun={() => runNow(a.id)}
    />
  );

  // Discover People splits into "From company" / "Standalone" (SPEC §3)
  const peopleGroups = useMemo(() => {
    if (tab !== "discover-person") return null;
    const fromCompany = tabAgents.filter(
      (a) => ovById.get(a.id)?.source === "company"
    );
    const standalone = tabAgents.filter(
      (a) => ovById.get(a.id)?.source === "standalone"
    );
    // agents with no declared source fall under standalone (free-brief default)
    const untagged = tabAgents.filter((a) => {
      const src = ovById.get(a.id)?.source;
      return src !== "company" && src !== "standalone";
    });
    return { fromCompany, standalone: [...standalone, ...untagged] };
  }, [tab, tabAgents, ovById]);

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div className="view-pad gather2">
      <div className="g-head">
        <div>
          <h2>Gather</h2>
          <span className="int-sub">
            Agent flock that discovers and stages new leads — human-approved into
            the network.
          </span>
        </div>
        <button className="btn" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="g-error">{error}</div>}

      {/* ---------- always-visible live agents strip ---------- */}
      <AgentsStrip
        agents={overview ? overview.agents : null}
        loading={overviewLoading}
        selectedId={selectedId}
        localRunningId={running?.agentId ?? null}
        onSelect={setSelectedId}
      />

      {/* ---------- tabs ---------- */}
      <div className="g-tabs">
        <div className="tabs">
          {TABS.map((t) => {
            const n = stagedCount(t.key);
            return (
              <button
                key={t.key}
                className={tab === t.key ? "on" : ""}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {n > 0 && <span className="tab-badge">{n}</span>}
              </button>
            );
          })}
        </div>
        <span className="g-flowhint">{activeTab.flow}</span>
      </div>

      {/* ---------- agents for this kind ---------- */}
      <div className="g-tab-section">
        {agents === null ? (
          <div className="g-loading">Loading…</div>
        ) : tab === "discover-person" && peopleGroups ? (
          <>
            <div className="g-group">
              <div className="g-col-label">From company</div>
              {peopleGroups.fromCompany.length === 0 ? (
                <div className="g-empty">
                  No company-sourced people agents yet.
                </div>
              ) : (
                <div className="g-agent-grid">
                  {peopleGroups.fromCompany.map(renderAgentCard)}
                </div>
              )}
            </div>
            <div className="g-group">
              <div className="g-col-label">Standalone</div>
              {peopleGroups.standalone.length === 0 ? (
                <div className="g-empty">
                  No standalone-brief agents yet (e.g. “STEM educators, Istanbul”).
                </div>
              ) : (
                <div className="g-agent-grid">
                  {peopleGroups.standalone.map(renderAgentCard)}
                </div>
              )}
            </div>
          </>
        ) : tabAgents.length === 0 ? (
          <div className="g-empty">No agents for this stage yet.</div>
        ) : (
          <div className="g-agent-grid">{tabAgents.map(renderAgentCard)}</div>
        )}
      </div>

      {/* ---------- staging review (filtered to this kind) ---------- */}
      <div className="g-stage">
        <div className="g-stage-head">
          <h3>Staging review</h3>
          <span className="g-stage-count">
            {tabStage.length} pending{" "}
            {tabStage.length === 1 ? "proposal" : "proposals"}
          </span>
        </div>
        {stage === null ? (
          <div className="g-loading">Loading…</div>
        ) : tabStage.length === 0 ? (
          <div className="g-stage-empty">
            <div className="g-check">✓</div>
            <div>Queue clear — nothing waiting for review in this stage.</div>
          </div>
        ) : (
          <div className="g-stage-grid">
            {tabStage.map((s) => (
              <div key={s.file} className="g-stage-card">
                <div className="g-stage-card-top">
                  <span className="g-stage-hint">{s.entity_hint}</span>
                </div>
                <div className="g-stage-summary">{s.summary}</div>
                <div className="g-fields">
                  {Object.entries(s.fields).map(([k, v]) => (
                    <span key={k} className="g-field">
                      <span className="g-field-k">{k}</span>
                      <span className="g-field-v">{v}</span>
                    </span>
                  ))}
                </div>
                <div className="g-stage-actions">
                  <button
                    className="btn primary"
                    disabled={busyStage === s.file}
                    onClick={() => decide(s.file, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busyStage === s.file}
                    onClick={() => decide(s.file, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- agent detail panel ---------- */}
      {selected && (
        <aside className="g-panel">
          <button
            className="g-panel-close"
            onClick={() => setSelectedId(null)}
            title="Close"
          >
            ✕
          </button>
          <div className="g-panel-head">
            <StatusDot
              status={
                running?.agentId === selected.id
                  ? "running"
                  : ovById.get(selected.id)?.status ?? selected.last_run?.status
              }
              enabled={selected.enabled}
            />
            <div>
              <div className="g-panel-name">{selected.name}</div>
              <div className="g-panel-sub">
                {selected.zone} · {selected.integration}
              </div>
            </div>
          </div>

          <div className="g-badges">
            <span className="g-model">{selected.model}</span>
            <span className="badge muted">{agentKind(selected)}</span>
            {ovById.get(selected.id)?.source && (
              <span className="badge muted">
                {ovById.get(selected.id)?.source}
              </span>
            )}
            <span className={`badge ${selected.enabled ? "ok" : "muted"}`}>
              {selected.enabled ? "enabled" : "disabled"}
            </span>
            <span className="badge muted">{selected.schedule}</span>
          </div>

          {ovById.get(selected.id)?.currentTask && (
            <div className="g-panel-current">
              <span className="g-dot running" />
              {ovById.get(selected.id)?.currentTask}
            </div>
          )}

          <p className="g-panel-desc">{taskDesc(selected.task)}</p>

          <div className="g-panel-block">
            <div className="g-block-label">Parameters</div>
            <pre className="g-params">
              {JSON.stringify(selected.params, null, 2)}
            </pre>
          </div>

          <div className="g-panel-block">
            <button
              className="btn primary g-run-btn"
              disabled={running?.agentId === selected.id}
              onClick={() => runNow(selected.id)}
            >
              {running?.agentId === selected.id ? (
                <>
                  <span className="g-spin" /> Running…
                </>
              ) : (
                "Run now"
              )}
            </button>
            {running?.agentId === selected.id && (
              <div className="g-run-note">
                Live scrape in progress — journal updates when it finishes.
              </div>
            )}
          </div>

          <div className="g-panel-block">
            <div className="g-block-label">Run history</div>
            <RunTimeline runs={runs} />
            {runs.length === 0 ? (
              <div className="muted g-runs-empty">No runs yet.</div>
            ) : (
              <div className="g-runs">
                {runs.map((r) => (
                  <div key={r.id} className={`g-run-row ${r.status}`}>
                    <StatusDot status={r.status} enabled />
                    <span className="g-run-when">{timeAgo(r.started)}</span>
                    <span className="g-run-stats">
                      {r.items_out} out · {r.staged} staged
                      {duration(r.started, r.ended)
                        ? ` · ${duration(r.started, r.ended)}`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
