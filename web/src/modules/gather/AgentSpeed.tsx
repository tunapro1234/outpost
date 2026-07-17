import { useEffect, useRef, useState } from "react";
import type { Agent, GatherKind } from "@/core/types";
import { api } from "@/core/api";

// ---- throughput presets (6 rungs) ---------------------------------------
// Each rung maps a slider position to a schedule + per-run item limit. The
// summary throughput is limit × runs-per-hour.
interface SpeedStep {
  label: string;
  enabled: boolean;
  schedule: string | null; // null = leave schedule untouched (Paused)
  limit: number;
  runsPerHour: number;
}

const STEPS: SpeedStep[] = [
  { label: "Paused", enabled: false, schedule: null, limit: 0, runsPerHour: 0 },
  { label: "Every 12 h", enabled: true, schedule: "15 3,15 * * *", limit: 5, runsPerHour: 1 / 12 },
  { label: "Every 6 h", enabled: true, schedule: "15 */6 * * *", limit: 5, runsPerHour: 1 / 6 },
  { label: "Every 3 h", enabled: true, schedule: "15 */3 * * *", limit: 5, runsPerHour: 1 / 3 },
  { label: "Hourly", enabled: true, schedule: "15 * * * *", limit: 5, runsPerHour: 1 },
  { label: "Every 30 min", enabled: true, schedule: "5,35 * * * *", limit: 5, runsPerHour: 2 },
  { label: "Every 15 min", enabled: true, schedule: "*/15 * * * *", limit: 5, runsPerHour: 4 },
  { label: "Unlimited", enabled: true, schedule: "*/5 * * * *", limit: 10, runsPerHour: 12 },
];

const NOUN: Record<GatherKind, string> = {
  "discover-company": "companies",
  "discover-person": "people",
  enrich: "records",
};

// Estimate the minutes between runs from a cron minute/hour field, or null
// when the schedule is manual / unparseable.
function cronPeriodMinutes(schedule: string): number | null {
  const s = schedule.trim().toLowerCase();
  if (!s || s === "manual" || s === "none") return null;
  const fields = s.split(/\s+/);
  const minute = fields[0] ?? "*";
  const hour = fields[1] ?? "*";
  if (minute.startsWith("*/")) {
    const n = Number(minute.slice(2));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const hourPeriod = (h: string): number | null => {
    if (h === "*") return 1;
    if (h.startsWith("*/")) {
      const n = Number(h.slice(2));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (h.includes(",")) {
      const count = h.split(",").filter(Boolean).length;
      return count > 0 ? Math.round(24 / count) : null;
    }
    if (/^\d+$/.test(h)) return 24; // tek sabit saat → günlük
    return null;
  };
  if (minute.includes(",")) {
    const count = minute.split(",").filter(Boolean).length;
    return hour === "*" && count > 0 ? Math.round(60 / count) : null;
  }
  if (/^\d+$/.test(minute)) {
    // fixed minute: period comes from the hour field (hourly / every N hours / daily)
    const hp = hourPeriod(hour);
    return hp == null ? null : hp * 60;
  }
  return null;
}

// Pick the slider rung that best matches an agent's current schedule.
function deriveStep(agent: Agent): number {
  if (!agent.enabled) return 0;
  const period = cronPeriodMinutes(agent.schedule);
  if (period == null) return 0; // manual while enabled → Paused view (Run now handles it)
  let best = 1;
  let bestDelta = Infinity;
  for (let i = 1; i < STEPS.length; i++) {
    const target = 60 / STEPS[i].runsPerHour;
    const delta = Math.abs(target - period);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

export default function AgentSpeed({
  agent,
  kind,
  onUpdated,
}: {
  agent: Agent;
  kind: GatherKind;
  onUpdated: (a: Agent) => void;
}) {
  const serverStep = deriveStep(agent);
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [unavailable, setUnavailable] = useState(false);
  const timer = useRef<number | null>(null);

  // Reset local state whenever a different agent is selected.
  useEffect(() => {
    setOptimistic(null);
    setStatus("idle");
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [agent.id]);

  const step = optimistic ?? serverStep;
  const preset = STEPS[step];
  const noun = NOUN[kind] ?? "items";
  const throughput = preset.limit * preset.runsPerHour;

  const flash = (s: "saved" | "error") => {
    setStatus(s);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 1800);
  };

  const apply = async (next: number) => {
    if (next === step || unavailable) return;
    const target = STEPS[next];
    setOptimistic(next);
    setStatus("saving");
    try {
      const body =
        next === 0
          ? { enabled: false }
          : {
              enabled: true,
              schedule: target.schedule!,
              params: { ...agent.params, limit: target.limit },
            };
      const updated = await api.patchAgent(agent.id, body);
      onUpdated(updated); // serverStep now reflects the change
      setOptimistic(null);
      flash("saved");
    } catch (e) {
      setOptimistic(null); // revert to previous value
      if (/\b404\b/.test((e as Error)?.message ?? "")) {
        setUnavailable(true);
      } else {
        flash("error");
      }
    }
  };

  return (
    <div className="g-panel-block g-speed">
      <div className="g-speed-head">
        <div className="g-block-label">Throughput</div>
        <div className={`g-speed-status ${status}`}>
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved"}
          {status === "error" && "Couldn't save, so we reverted it"}
        </div>
      </div>

      <input
        className="g-speed-range"
        type="range"
        min={0}
        max={STEPS.length - 1}
        step={1}
        value={step}
        disabled={unavailable}
        aria-label="Agent throughput"
        list="g-speed-ticks"
        onChange={(e) => apply(Number(e.target.value))}
      />
      <datalist id="g-speed-ticks">
        {STEPS.map((_, i) => (
          <option key={i} value={i} />
        ))}
      </datalist>

      <div className="g-speed-scale" aria-hidden="true">
        {STEPS.map((s, i) => (
          <button
            key={i}
            type="button"
            className={`g-speed-tick ${i === step ? "on" : ""}`}
            disabled={unavailable}
            title={s.label}
            onClick={() => apply(i)}
          >
            <span className="g-speed-dot" />
          </button>
        ))}
      </div>

      <div className="g-speed-readout">
        <span className={`g-speed-preset ${step === 0 ? "paused" : ""}`}>
          {preset.label}
        </span>
        <span className="g-speed-rate">
          {unavailable
            ? "speed control coming online"
            : step === 0
              ? "Nothing scheduled. Hit Run now to go"
              : throughput < 1
                ? `≈ ${Math.round(throughput * 24)} ${noun}/day`
                : `≈ ${Math.round(throughput)} ${noun}/hour`}
        </span>
      </div>
    </div>
  );
}
