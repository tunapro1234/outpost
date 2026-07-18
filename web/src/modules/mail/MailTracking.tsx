import { useMemo, useState } from "react";
import type { MailRecord, MailAnalytics } from "@/core/types";
import { relativeTime } from "@/core/format";

// Dedicated tracking view: a delivery→open→click→reply funnel plus a per-mail
// table of live engagement state and timings. Open tracking is noisy, so proxy
// prefetch is shown apart from real opens and "replied without open" is flagged
// as a success, never a miss.

function dur(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} dk`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} sa`;
  return `${Math.round(h / 24)} gün`;
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—";
}

type Filter = "all" | "opened" | "clicked" | "replied" | "prefetch" | "cold";

const FILTERS: { k: Filter; label: string }[] = [
  { k: "all", label: "Tümü" },
  { k: "opened", label: "Açıldı" },
  { k: "clicked", label: "Tıklandı" },
  { k: "replied", label: "Yanıtladı" },
  { k: "prefetch", label: "Sadece prefetch" },
  { k: "cold", label: "Tutmadı" },
];

function matches(r: MailRecord, f: Filter): boolean {
  switch (f) {
    case "opened": return r.tracking.open_count > 0;
    case "clicked": return r.tracking.click_count > 0;
    case "replied": return r.reply.replied;
    case "prefetch": return r.tracking.open_count === 0 && r.tracking.proxy_open_count > 0;
    case "cold": return r.flags.cold;
    default: return true;
  }
}

function StatusBadge({ r }: { r: MailRecord }) {
  const s = r.tracking.status;
  const label =
    s === "clicked" ? "tıklandı"
    : s === "opened" ? "açıldı"
    : s === "proxy_open" ? "prefetch"
    : s === "delivered" ? "ulaştı"
    : s === "bounced" ? "geri döndü"
    : s === "sent" ? "gönderildi"
    : s === "scheduled" ? "planlandı"
    : s === "canceled" ? "iptal"
    : s;
  return <span className={`track-badge track-${s}`}>{label}</span>;
}

export default function MailTracking({
  records,
  analytics,
  onOpenEntity,
}: {
  records: MailRecord[];
  analytics: MailAnalytics | null;
  onOpenEntity: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c = { total: records.length, opened: 0, clicked: 0, replied: 0, prefetch: 0, cold: 0 };
    for (const r of records) {
      if (r.tracking.open_count > 0) c.opened += 1;
      if (r.tracking.click_count > 0) c.clicked += 1;
      if (r.reply.replied) c.replied += 1;
      if (r.tracking.open_count === 0 && r.tracking.proxy_open_count > 0) c.prefetch += 1;
      if (r.flags.cold) c.cold += 1;
    }
    return c;
  }, [records]);

  const rows = useMemo(() => records.filter((r) => matches(r, filter)), [records, filter]);

  if (records.length === 0) {
    return (
      <div className="empty-state">
        <div className="es-title">İzlenecek mail yok</div>
        <div className="es-sub">
          Mailler gönderildikçe açılma, tıklama ve yanıt durumları burada canlı olarak izlenir.
          Açılma yumuşak bir sinyaldir (mail proxy'leri görselleri önden yükler); tıklama ve
          yanıt gerçek olandır.
        </div>
      </div>
    );
  }

  const o = analytics?.overall;

  return (
    <div className="track-wrap">
      {/* Funnel: her adım bir önceki kümenin oranı olarak okunur. */}
      <div className="funnel">
        <div className="fstep"><span className="fn">{counts.total}</span><span className="fl">gönderildi</span></div>
        <div className="farrow">→</div>
        <div className="fstep"><span className="fn">{counts.opened}</span><span className="fl">açıldı {pct(counts.opened, counts.total)}</span></div>
        <div className="farrow">→</div>
        <div className="fstep"><span className="fn">{counts.clicked}</span><span className="fl">tıkladı {pct(counts.clicked, counts.total)}</span></div>
        <div className="farrow">→</div>
        <div className="fstep accent"><span className="fn">{counts.replied}</span><span className="fl">yanıtladı {pct(counts.replied, counts.total)}</span></div>
        {o ? (
          <div className="fmeta">
            medyan açılma {dur(o.median_time_to_open_ms)} · medyan yanıt {dur(o.median_time_to_reply_ms)}
            {o.replied_without_open > 0 ? ` · ${o.replied_without_open} açılmadan yanıt` : ""}
          </div>
        ) : null}
      </div>

      <div className="track-filters">
        {FILTERS.map((f) => {
          const n =
            f.k === "all" ? counts.total
            : f.k === "opened" ? counts.opened
            : f.k === "clicked" ? counts.clicked
            : f.k === "replied" ? counts.replied
            : f.k === "prefetch" ? counts.prefetch
            : counts.cold;
          return (
            <button
              key={f.k}
              className={`tf-chip${filter === f.k ? " on" : ""}`}
              onClick={() => setFilter(f.k)}
            >
              {f.label}<span className="tf-n">{n}</span>
            </button>
          );
        })}
      </div>

      <table className="grid mails-grid track-grid">
        <thead>
          <tr>
            <th>Kişi</th>
            <th>Konu</th>
            <th style={{ width: 96 }}>Gönderim</th>
            <th style={{ width: 120 }}>Açılma</th>
            <th style={{ width: 90 }}>Tıklama</th>
            <th style={{ width: 150 }}>Yanıt</th>
            <th style={{ width: 100 }}>Durum</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button className="link-btn" onClick={() => onOpenEntity(r.person.id)}>
                  {r.person.name}
                </button>
              </td>
              <td className="track-subj">{r.subject ?? "—"}</td>
              <td className="mono">{relativeTime(r.sent_at ?? r.approved_at ?? undefined) ?? "—"}</td>
              <td>
                {r.tracking.open_count > 0 ? (
                  <span title={r.tracking.first_open ? `ilk: ${relativeTime(r.tracking.first_open)}` : ""}>
                    {r.tracking.open_count}× · {dur(r.durations.time_to_open_ms)}
                  </span>
                ) : r.tracking.proxy_open_count > 0 ? (
                  <span className="dim">prefetch</span>
                ) : (
                  <span className="dim">—</span>
                )}
              </td>
              <td>{r.tracking.click_count > 0 ? `${r.tracking.click_count}×` : <span className="dim">—</span>}</td>
              <td>
                {r.reply.replied ? (
                  <span className="track-badge track-clicked">
                    {r.reply.reply_at ? relativeTime(r.reply.reply_at) : "evet"} · {dur(r.durations.time_to_reply_ms)}
                  </span>
                ) : r.flags.cold ? (
                  <span className="flag-chip flag-cold">tutmadı</span>
                ) : (
                  <span className="dim">bekleniyor</span>
                )}
              </td>
              <td><StatusBadge r={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
