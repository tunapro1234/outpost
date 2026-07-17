import { useEffect, useState } from "react";
import { api } from "@/core/api";

// ---- Pipeline band -------------------------------------------------------
// End-to-end view of the production line: a feeder depot ("Awaiting scan")
// flows into four stages — People scanned → Mail queue → Drafts pending
// approval → Approved (outbox). Live accumulation on each box; the busiest
// intermediate stage is flagged as the bottleneck. Polls every 15s and hides
// itself entirely if the backing queue endpoint is unreachable.

const POLL_MS = 15_000;

interface Snapshot {
  awaitingScan: number;
  scanned: number | null; // metrics.gather.staged
  queue: number;
  drafts: number | null; // maildrafts length
  approved: number | null; // no API source yet → renders "—"
}

// stages that participate in the bottleneck rule (intermediate, numeric)
type StageKey = "scanned" | "queue" | "drafts";

function fmt(v: number | null): string {
  return typeof v === "number" ? v.toLocaleString("en-US") : "—";
}

function Box({
  label,
  hint,
  value,
  feeder,
  bottleneck,
}: {
  label: string;
  hint: string;
  value: number | null;
  feeder?: boolean;
  bottleneck?: boolean;
}) {
  return (
    <div
      className={`g-pipe-box ${feeder ? "feeder" : ""} ${
        bottleneck ? "bottleneck" : ""
      }`}
    >
      <div className="g-pipe-box-head">
        <span className="g-pipe-label">{label}</span>
        {bottleneck && <span className="g-pipe-badge">bottleneck</span>}
      </div>
      <div className="g-pipe-num">{fmt(value)}</div>
      <div className="g-pipe-hint">{hint}</div>
    </div>
  );
}

// thin n8n-style connector (line + arrowhead), CSS/SVG only
function Link({ feed }: { feed?: boolean }) {
  return (
    <div className={`g-pipe-link ${feed ? "feed" : ""}`} aria-hidden>
      <svg viewBox="0 0 32 12" preserveAspectRatio="none">
        <path d="M0 6 H26" />
        <path d="M22 2 L28 6 L22 10" fill="none" />
      </svg>
    </div>
  );
}

export default function PipelineFlow() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // mailqueue is the backbone; drafts + metrics are best-effort extras.
      const [mq, drafts, metrics] = await Promise.all([
        api.mailqueue(),
        api.maildrafts(),
        api.metrics(),
      ]);
      if (!alive) return;
      if (!mq) {
        // primary source unavailable → hide the band gracefully
        setHidden(true);
        return;
      }
      setHidden(false);
      setSnap({
        awaitingScan: mq.counts.awaitingScan,
        queue: mq.counts.queue,
        drafts: drafts ? drafts.length : null,
        scanned: metrics ? metrics.gather.staged : null,
        approved: null,
      });
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (hidden || !snap) return null;

  // bottleneck = intermediate stage with the highest absolute accumulation
  const candidates: { key: StageKey; value: number }[] = [
    { key: "scanned", value: snap.scanned ?? -1 },
    { key: "queue", value: snap.queue },
    { key: "drafts", value: snap.drafts ?? -1 },
  ];
  let bottleneck: StageKey | null = null;
  let best = 0; // must be a positive accumulation to flag anything
  for (const c of candidates) {
    if (c.value > best) {
      best = c.value;
      bottleneck = c.key;
    }
  }

  return (
    <section className="g-pipeline">
      <div className="g-pipe-head">
        <span className="g-pipe-title">Pipeline</span>
        <span className="g-pipe-sub">Live production flow · refreshes every 15s</span>
      </div>
      <div className="g-pipe-scroll">
        <div className="g-pipe-flow">
          <Box
            feeder
            label="Awaiting scan"
            hint="people to scan"
            value={snap.awaitingScan}
          />
          <Link feed />
          <Box
            label="People scanned"
            hint="staged for review"
            value={snap.scanned}
            bottleneck={bottleneck === "scanned"}
          />
          <Link />
          <Box
            label="Mail queue"
            hint="ready to draft"
            value={snap.queue}
            bottleneck={bottleneck === "queue"}
          />
          <Link />
          <Box
            label="Drafts pending approval"
            hint="awaiting review"
            value={snap.drafts}
            bottleneck={bottleneck === "drafts"}
          />
          <Link />
          <Box
            label="Approved (outbox)"
            hint="ready to send"
            value={snap.approved}
          />
        </div>
      </div>
    </section>
  );
}
