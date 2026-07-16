import { useEffect, useMemo, useState } from "react";
import type { MailItem, Metrics } from "@/core/types";
import type { NavKey } from "@/layout/Sidebar";
import type { ThemeName } from "@/core/theme";
import { TYPE_LABELS, TYPE_ORDER, typeColors } from "@/core/theme";
import { api } from "@/core/api";
import DraftCard from "@/modules/mail/DraftCard";
import { useMailDrafts } from "@/modules/mail/useMailDrafts";

interface Props {
  theme: ThemeName;
  mails: MailItem[] | null;
  onOpenEntity: (id: string) => void;
  onNavigate: (k: NavKey) => void;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

// "Jul 3", "Jul 3, 2025" if not current year
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return fmtDate(iso);
}

interface Activity {
  key: string;
  when: string | null;
  icon: "out" | "in" | "gather";
  title: string;
  sub: string;
  entityId?: string;
}

export default function OverviewView({
  theme,
  mails,
  onOpenEntity,
  onNavigate,
}: Props) {
  const TC = typeColors(theme);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const drafts = useMailDrafts();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .metrics()
      .then((m) => {
        if (!alive) return;
        setMetrics(m);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setMetrics(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const daily = metrics?.outreach.daily ?? [];
  const dailyMax = useMemo(
    () => Math.max(1, ...daily.map((d) => d.count)),
    [daily]
  );

  const typeRows = useMemo(() => {
    const by = metrics?.totals.byType ?? {};
    const total = metrics?.totals.entities || 0;
    return TYPE_ORDER.map((t) => ({
      type: t,
      label: TYPE_LABELS[t],
      count: by[t] ?? 0,
      pct: total ? ((by[t] ?? 0) / total) * 100 : 0,
    })).filter((r) => r.count > 0);
  }, [metrics]);

  const activity = useMemo<Activity[]>(() => {
    const items: Activity[] = [];
    for (const m of mails ?? []) {
      const name = m.person_name || m.entity_name || "Unknown";
      items.push({
        key: `mail-${m.id}`,
        when: m.date,
        icon: m.direction === "in" ? "in" : "out",
        title: m.subject || (m.direction === "in" ? "Inbound mail" : "Outbound mail"),
        sub: `${m.direction === "in" ? "From" : "To"} ${name}`,
        entityId: m.person_id || m.entity_id,
      });
    }
    items.sort((a, b) => {
      const ta = a.when ? new Date(a.when).getTime() : 0;
      const tb = b.when ? new Date(b.when).getTime() : 0;
      return tb - ta;
    });
    return items.slice(0, 8);
  }, [mails]);

  if (loading) {
    return (
      <div className="view-pad overview">
        <div className="ov-loading">Loading…</div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="view-pad overview">
        <div className="empty-state">
          <div className="es-title">Metrics unavailable</div>
          <div className="es-sub">
            The <code>/metrics</code> endpoint did not respond. Once it is live
            this dashboard will show reach, mail volume and gather activity at a
            glance.
          </div>
        </div>
      </div>
    );
  }

  const o = metrics.outreach;
  const kpis: { k: string; v: string; tone?: string; hint?: string }[] = [
    { k: "Reached people", v: fmtNum(o.uniqueRecipients), hint: "unique recipients" },
    { k: "Mails sent", v: fmtNum(o.mailsSent), tone: "var(--warn)" },
    {
      k: "Avg / day",
      v: o.avgPerActiveDay ? o.avgPerActiveDay.toFixed(1) : "0",
      hint: `${fmtNum(o.activeDays)} active days`,
    },
    { k: "Total entities", v: fmtNum(metrics.totals.entities) },
    { k: "Staged", v: fmtNum(metrics.gather.staged), tone: "var(--ok)" },
  ];

  // Mail approval queue. Hidden entirely while the endpoint is absent (null);
  // a quiet one-line note when reachable but empty.
  const draftList = drafts.drafts;
  const draftsSection =
    draftList === null ? null : (
      <section className="md-section">
        <div className="md-section-head">
          <h3 className="md-section-title">Mails awaiting approval</h3>
          {draftList.length > 0 && (
            <span className="md-section-count">{draftList.length}</span>
          )}
        </div>
        {draftList.length === 0 ? (
          <div className="md-empty">No drafts awaiting approval.</div>
        ) : (
          <div className="md-grid">
            {draftList.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                busy={drafts.busyId === d.id}
                onApprove={drafts.approve}
                onReject={drafts.reject}
                onOpenEntity={onOpenEntity}
              />
            ))}
          </div>
        )}
      </section>
    );

  const daily30Total = daily.reduce((s, d) => s + d.count, 0);
  const rangeLabel =
    o.firstMailAt && o.lastMailAt
      ? `${fmtDate(o.firstMailAt)} — ${fmtDate(o.lastMailAt)}`
      : "No outreach yet";

  return (
    <div className="view-pad overview">
      <div className="ov-head">
        <h2>Overview</h2>
        <div className="ov-sub">{rangeLabel}</div>
      </div>

      {/* KPI cards */}
      <div className="ov-kpis">
        {kpis.map((c) => (
          <div className="ov-kpi" key={c.k}>
            <div className="ov-kpi-v" style={c.tone ? { color: c.tone } : undefined}>
              {c.v}
            </div>
            <div className="ov-kpi-k">{c.k}</div>
            {c.hint && <div className="ov-kpi-hint">{c.hint}</div>}
          </div>
        ))}
      </div>

      {draftsSection}

      <div className="ov-grid">
        {/* daily mail bar chart */}
        <section className="ov-card ov-chart-card">
          <div className="ov-card-head">
            <div className="ov-card-title">Mail volume · last 30 days</div>
            <div className="ov-card-meta">{fmtNum(daily30Total)} sent</div>
          </div>
          {daily30Total === 0 ? (
            <div className="ov-chart-empty">No mail sent in this window.</div>
          ) : (
            <>
              <div className="ov-bars" role="img" aria-label="Daily mail volume">
                {daily.map((d) => (
                  <div
                    className="ov-bar-slot"
                    key={d.date}
                    title={`${fmtDate(d.date)}: ${d.count} mail${d.count === 1 ? "" : "s"}`}
                  >
                    <div
                      className={`ov-bar ${d.count === 0 ? "zero" : ""}`}
                      style={{ height: `${(d.count / dailyMax) * 100}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="ov-bars-axis">
                <span>{fmtDate(daily[0]?.date ?? null)}</span>
                <span>{fmtDate(daily[daily.length - 1]?.date ?? null)}</span>
              </div>
            </>
          )}
        </section>

        {/* type distribution */}
        <section className="ov-card">
          <div className="ov-card-head">
            <div className="ov-card-title">Entity types</div>
            <div className="ov-card-meta">{fmtNum(metrics.totals.entities)} total</div>
          </div>
          {typeRows.length === 0 ? (
            <div className="ov-chart-empty">No entities yet.</div>
          ) : (
            <>
              <div className="ov-typebar">
                {typeRows.map((r) => (
                  <div
                    key={r.type}
                    className="ov-typebar-seg"
                    style={{ width: `${r.pct}%`, background: TC[r.type] }}
                    title={`${r.label}: ${fmtNum(r.count)}`}
                  />
                ))}
              </div>
              <div className="ov-typelist">
                {typeRows.map((r) => (
                  <button
                    key={r.type}
                    className="ov-typerow"
                    onClick={() => onNavigate("network")}
                  >
                    <span className="ov-swatch" style={{ background: TC[r.type] }} />
                    <span className="ov-typerow-label">{r.label}</span>
                    <span className="ov-typerow-count">{fmtNum(r.count)}</span>
                    <span className="ov-typerow-pct">{r.pct.toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        {/* recent activity */}
        <section className="ov-card ov-activity-card">
          <div className="ov-card-head">
            <div className="ov-card-title">Recent activity</div>
            {mails && mails.length > 0 && (
              <button className="ov-card-link" onClick={() => onNavigate("reach")}>
                View all
              </button>
            )}
          </div>
          {activity.length === 0 ? (
            <div className="ov-chart-empty">No activity recorded yet.</div>
          ) : (
            <div className="ov-activity">
              {activity.map((a) => (
                <button
                  key={a.key}
                  className="ov-act-row"
                  onClick={() => a.entityId && onOpenEntity(a.entityId)}
                >
                  <span className={`ov-act-ico ${a.icon}`}>
                    {a.icon === "in" ? "←" : a.icon === "out" ? "→" : "+"}
                  </span>
                  <span className="ov-act-main">
                    <span className="ov-act-title">{a.title}</span>
                    <span className="ov-act-sub">{a.sub}</span>
                  </span>
                  <span className="ov-act-when">{relTime(a.when)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
