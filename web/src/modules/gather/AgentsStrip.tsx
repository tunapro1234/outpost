import type { OverviewAgent } from "@/core/types";

// Live status → dot class. Strip semantics (SPEC-GATHER2 §3):
// running = green pulse, idle = gray, error = red.
export function stripDotClass(status: string | undefined): string {
  if (status === "running") return "running";
  if (status === "error") return "error";
  return "idle";
}

const KIND_ABBR: Record<string, string> = {
  "discover-company": "company",
  "discover-person": "person",
  enrich: "enrich",
};

export default function AgentsStrip({
  agents,
  loading,
  selectedId,
  localRunningId,
  onSelect,
}: {
  agents: OverviewAgent[] | null; // null = endpoint unavailable
  loading: boolean;
  selectedId: string | null;
  localRunningId: string | null;
  onSelect: (id: string) => void;
}) {
  const runningCount =
    agents?.filter((a) => a.status === "running" || a.id === localRunningId)
      .length ?? 0;
  const total = agents?.length ?? 0;

  return (
    <div className="g-strip">
      <div className="g-strip-head">
        <span className="g-col-label">Agents</span>
        {agents && total > 0 && (
          <>
            <span className="g-strip-total">{total}</span>
            <span className="g-strip-live">
              {runningCount > 0 ? (
                <>
                  <span className="g-dot running" />
                  {runningCount} running
                </>
              ) : (
                <>
                  <span className="g-dot idle" />
                  all idle
                </>
              )}
            </span>
          </>
        )}
      </div>

      {loading && agents === null ? (
        <div className="g-strip-empty">Loading agents…</div>
      ) : !agents || agents.length === 0 ? (
        <div className="g-strip-empty">No agents online yet.</div>
      ) : (
        <div className="g-strip-pills">
          {agents.map((a) => {
            const status = a.id === localRunningId ? "running" : a.status;
            const running = status === "running";
            const task = a.currentTask ?? a.lastRunSummary;
            const line =
              running && a.currentTask
                ? a.currentTask
                : task ?? (a.enabled ? "idle" : "disabled");
            return (
              <button
                key={a.id}
                className={`g-pill ${selectedId === a.id ? "sel" : ""} ${
                  running ? "live" : ""
                }`}
                onClick={() => onSelect(a.id)}
                title={a.currentTask ?? a.name}
              >
                <span className={`g-dot ${stripDotClass(status)}`} />
                <span className="g-pill-body">
                  <span className="g-pill-top">
                    <span className="g-pill-name">{a.name}</span>
                    <span className="g-pill-kind">
                      {KIND_ABBR[a.kind] ?? a.kind}
                    </span>
                  </span>
                  <span className={`g-pill-task ${!a.enabled ? "off" : ""}`}>
                    {line}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
