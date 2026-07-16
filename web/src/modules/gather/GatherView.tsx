import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, AgentRun, StageItem } from "@/core/types";
import { api } from "@/core/api";

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

export default function GatherView() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [stage, setStage] = useState<StageItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const totalStaged = (agents ?? []).reduce(
    (n, a) => n + (a.last_run?.staged ?? 0),
    0
  );
  const pendingCount = stage?.length ?? 0;

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

      {/* ---------- flow canvas ---------- */}
      <div className="g-flow">
        {/* sources column */}
        <div className="g-col">
          <div className="g-col-label">Sources</div>
          <div className="g-src-node">
            <span className="g-src-ico" aria-hidden>
              🌐
            </span>
            <div className="g-src-meta">
              <div className="g-src-name">Browser</div>
              <div className="g-src-sub">Shared crawler</div>
            </div>
          </div>
          <div className="g-src-node ghost">
            <span className="g-src-ico" aria-hidden>
              ＋
            </span>
            <div className="g-src-meta">
              <div className="g-src-name">Add source</div>
              <div className="g-src-sub">Places · Serper — soon</div>
            </div>
          </div>
        </div>

        <div className="g-edge">
          <span className="g-edge-line" />
          <span className="g-edge-count">
            {agents && agents.length
              ? `${(agents[0].last_run?.items_in ?? 0)} scanned`
              : "—"}
          </span>
        </div>

        {/* agents column */}
        <div className="g-col agents">
          <div className="g-col-label">Agents</div>
          {agents === null ? (
            <div className="g-loading">Loading…</div>
          ) : agents.length === 0 ? (
            <div className="g-empty">No agents configured</div>
          ) : (
            agents.map((a) => {
              const lr = a.last_run;
              const isRunning = running?.agentId === a.id;
              const st = isRunning ? "running" : lr?.status;
              return (
                <button
                  key={a.id}
                  className={`g-agent ${selectedId === a.id ? "sel" : ""}`}
                  onClick={() => setSelectedId(a.id)}
                >
                  <div className="g-agent-top">
                    <StatusDot status={st} enabled={a.enabled} />
                    <span className="g-agent-name">{a.name}</span>
                    <span className="g-model">{a.model}</span>
                  </div>
                  <div className="g-agent-task">{a.task}</div>
                  <div className="g-agent-foot">
                    {isRunning ? (
                      <span className="g-run-live">
                        <span className="g-spin" /> Running…
                      </span>
                    ) : lr ? (
                      <>
                        <span>{timeAgo(lr.started)}</span>
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
                      <span className="muted">never run</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="g-edge">
          <span className="g-edge-line" />
          <span className="g-edge-count">{totalStaged} staged</span>
        </div>

        {/* target */}
        <div className="g-col">
          <div className="g-col-label">Target</div>
          <div className="g-target-node">
            <span className="g-target-ico" aria-hidden>
              ◈
            </span>
            <div className="g-src-meta">
              <div className="g-src-name">Network</div>
              <div className="g-src-sub">
                {pendingCount > 0
                  ? `${pendingCount} pending review`
                  : "vault graph"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- staging review ---------- */}
      <div className="g-stage">
        <div className="g-stage-head">
          <h3>Staging review</h3>
          <span className="g-stage-count">
            {pendingCount} pending {pendingCount === 1 ? "proposal" : "proposals"}
          </span>
        </div>
        {stage === null ? (
          <div className="g-loading">Loading…</div>
        ) : stage.length === 0 ? (
          <div className="g-stage-empty">
            <div className="g-check">✓</div>
            <div>Queue clear — nothing waiting for review.</div>
          </div>
        ) : (
          <div className="g-stage-grid">
            {stage.map((s) => (
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
              status={running?.agentId === selected.id ? "running" : selected.last_run?.status}
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
            <span className={`badge ${selected.enabled ? "ok" : "muted"}`}>
              {selected.enabled ? "enabled" : "disabled"}
            </span>
            <span className="badge muted">{selected.schedule}</span>
          </div>

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
