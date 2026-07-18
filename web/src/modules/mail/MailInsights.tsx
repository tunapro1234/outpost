import type { MailAnalytics, MailAnalyticsCell } from "@/core/types";

function pct(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function minutes(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} dk`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} sa`;
  return `${Math.round(h / 24)} gün`;
}

// One breakdown table. The reply-rate cell carries a proportional bar so the
// best-performing bucket reads at a glance — reply rate is the north star.
function Breakdown({ title, cells }: { title: string; cells: MailAnalyticsCell[] }) {
  if (!cells.length) return null;
  const maxReply = Math.max(1, ...cells.map((c) => c.reply_rate));
  return (
    <div className="insight-card">
      <div className="insight-title">{title}</div>
      <table className="insight-table">
        <thead>
          <tr>
            <th>Segment</th>
            <th className="num">n</th>
            <th className="num">Açılma</th>
            <th className="num">Tıklama</th>
            <th className="num">Yanıt</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={c.key}>
              <td className="insight-key">{c.key}</td>
              <td className="num">{c.n}</td>
              <td className="num dim">{pct(c.open_rate)}</td>
              <td className="num dim">{pct(c.click_rate)}</td>
              <td className="num">
                <span className="reply-cell">
                  <span
                    className="reply-bar"
                    style={{ width: `${(c.reply_rate / maxReply) * 100}%` }}
                  />
                  <span className="reply-val">{pct(c.reply_rate)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MailInsights({ analytics }: { analytics: MailAnalytics | null }) {
  if (!analytics) {
    return (
      <div className="empty-state">
        <div className="es-title">Insights coming online</div>
        <div className="es-sub">
          We can't reach the analytics endpoint just yet.
        </div>
      </div>
    );
  }
  if (analytics.total === 0) {
    return (
      <div className="empty-state">
        <div className="es-title">No sent mail to analyse yet</div>
        <div className="es-sub">
          Once mails go out, reply rate is broken down here by model, tone,
          score, send time and follow-up stage, so you can see what actually
          gets replies.
        </div>
      </div>
    );
  }
  const o = analytics.overall;
  return (
    <div className="insights">
      <div className="insight-kpis">
        <div className="ikpi">
          <span className="ikpi-n">{o.n}</span>
          <span className="ikpi-l">mail</span>
        </div>
        <div className="ikpi">
          <span className="ikpi-n">{pct(o.open_rate)}</span>
          <span className="ikpi-l">açılma</span>
        </div>
        <div className="ikpi">
          <span className="ikpi-n">{pct(o.click_rate)}</span>
          <span className="ikpi-l">tıklama</span>
        </div>
        <div className="ikpi accent">
          <span className="ikpi-n">{pct(o.reply_rate)}</span>
          <span className="ikpi-l">yanıt</span>
        </div>
        <div className="ikpi">
          <span className="ikpi-n">{pct(o.reply_rate_given_open)}</span>
          <span className="ikpi-l">açanların yanıtı</span>
        </div>
        <div className="ikpi">
          <span className="ikpi-n">{minutes(o.median_time_to_reply_ms)}</span>
          <span className="ikpi-l">medyan yanıt süresi</span>
        </div>
      </div>

      <div className="insight-grid">
        <Breakdown title="Modele göre" cells={analytics.by_model} />
        <Breakdown title="Tona göre" cells={analytics.by_tone} />
        <Breakdown title="Skora göre" cells={analytics.by_score} />
        <Breakdown title="Follow-up aşamasına göre" cells={analytics.by_followup} />
        <Breakdown title="Konu uzunluğuna göre" cells={analytics.by_subject_length} />
        <Breakdown title="Gönderim saatine göre (UTC)" cells={analytics.by_hour} />
        <Breakdown title="Güne göre" cells={analytics.by_weekday} />
        <Breakdown title="Yazara göre" cells={analytics.by_author} />
      </div>
    </div>
  );
}
