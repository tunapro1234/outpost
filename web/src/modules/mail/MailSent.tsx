import { useState } from "react";
import type { MailRecord, MailRecordDetail } from "@/core/types";
import { relativeTime } from "@/core/format";

const STATUS_LABEL: Record<string, string> = {
  queued: "queued",
  sent: "sent",
  delivered: "delivered",
  proxy_open: "prefetch",
  opened: "opened",
  clicked: "clicked",
  bounced: "bounced",
};

function StatusBadge({ r }: { r: MailRecord }) {
  const s = r.tracking.status;
  const label = STATUS_LABEL[s] ?? s;
  const count = s === "clicked" ? r.tracking.click_count : s === "opened" ? r.tracking.open_count : 0;
  return (
    <span className={`track-badge track-${s}`}>
      {label}
      {count > 1 ? ` ×${count}` : ""}
    </span>
  );
}

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="mp-field">
      <span className="mp-k">{k}</span>
      <span className="mp-v">{v}</span>
    </div>
  );
}

// The full-provenance drawer: how the mail was made (model, prompt, time),
// what happened to it (tracking events), and whether it got a reply.
function Detail({ id, loader }: { id: string; loader: (id: string) => Promise<MailRecordDetail | null> }) {
  const [detail, setDetail] = useState<MailRecordDetail | null | "loading">("loading");
  const [showPrompt, setShowPrompt] = useState(false);
  if (detail === "loading") {
    void loader(id).then((d) => setDetail(d));
    return <div className="mp-loading">Yükleniyor…</div>;
  }
  if (!detail) return <div className="mp-loading">Kayıt yüklenemedi.</div>;
  const g = detail.generation_full ?? detail.generation;
  return (
    <div className="mail-prov">
      <div className="mp-cols">
        <section className="mp-sec">
          <h4>Mail</h4>
          <Field k="Kime" v={detail.to ?? "—"} />
          <Field k="Konu" v={detail.subject ?? "—"} />
          <Field k="Ton" v={detail.tone ?? "—"} />
          <Field k="Skor" v={detail.score ?? "—"} />
          {detail.body ? <pre className="mp-body">{detail.body}</pre> : null}
        </section>

        <section className="mp-sec">
          <h4>Nasıl üretildi</h4>
          <Field k="Model" v={g?.model ?? "—"} />
          <Field k="Motor" v={g?.engine ?? "—"} />
          <Field k="Üretim zamanı" v={g?.generated_at ? relativeTime(g.generated_at) : "—"} />
          <Field k="Süre" v={ms(g?.generation_ms)} />
          <Field k="Bağlam modeli" v={`${g?.context_model ?? "—"} (${ms(g?.context_ms)})`} />
          <Field k="Deneme" v={g?.attempts ?? "—"} />
          <Field
            k="Token"
            v={g?.usage ? `${g.usage.tokens_in ?? "?"} in / ${g.usage.tokens_out ?? "?"} out${g.usage.estimated ? " (tahmini)" : ""}` : "—"}
          />
          {g?.skills?.length ? <Field k="Skill'ler" v={g.skills.join(", ")} /> : null}
          {detail.generation_full?.prompt ? (
            <>
              <button className="mp-toggle" onClick={() => setShowPrompt((s) => !s)}>
                {showPrompt ? "▾ Prompt'u gizle" : "▸ Prompt'u göster"}
              </button>
              {showPrompt ? <pre className="mp-prompt">{detail.generation_full.prompt}</pre> : null}
            </>
          ) : null}
        </section>

        <section className="mp-sec">
          <h4>Ne oldu</h4>
          <Field k="Durum" v={detail.tracking.status} />
          <Field
            k="Açılma"
            v={`${detail.tracking.open_count} gerçek${detail.tracking.proxy_open_count ? ` · ${detail.tracking.proxy_open_count} prefetch` : ""}`}
          />
          <Field k="Tıklama" v={detail.tracking.click_count} />
          {detail.tracking.clicks?.length
            ? detail.tracking.clicks.map((c) => (
                <Field key={c.link_index} k={`Link #${c.link_index}`} v={`${c.count}× ${c.url ?? ""}`} />
              ))
            : null}
          <Field
            k="Yanıt"
            v={
              detail.reply.replied
                ? `Evet · ${detail.reply.reply_at ? relativeTime(detail.reply.reply_at) : ""}${detail.reply.reply_subject ? ` · "${detail.reply.reply_subject}"` : ""}`
                : "Henüz yok"
            }
          />
        </section>
      </div>
    </div>
  );
}

export default function MailSent({
  records,
  detail,
  onOpenEntity,
}: {
  records: MailRecord[];
  detail: (id: string) => Promise<MailRecordDetail | null>;
  onOpenEntity: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (records.length === 0) {
    return (
      <div className="empty-state">
        <div className="es-title">No mail sent yet</div>
        <div className="es-sub">
          Approved mails land here with their open/click state, reply status and
          the full record of how each one was written.
        </div>
      </div>
    );
  }
  return (
    <div className="md-rows">
      {records.map((r) => {
        const open = openId === r.id;
        return (
          <div key={r.id} className={`md-rowwrap ${open ? "open" : ""}`}>
            <button className="md-row" onClick={() => setOpenId(open ? null : r.id)}>
              <span className="md-row-caret">{open ? "▾" : "▸"}</span>
              <span className="md-row-person">{r.person.name}</span>
              <span className="md-row-company">{r.subject ?? "—"}</span>
              <span className="md-row-when">{relativeTime(r.approved_at ?? r.created_at ?? undefined) ?? ""}</span>
              {r.reply.replied ? <span className="track-badge track-clicked">yanıtladı</span> : null}
              {r.generation?.model ? <span className="mp-model-tag">{r.generation.model}</span> : null}
              <StatusBadge r={r} />
            </button>
            {open ? (
              <div className="md-rowbody">
                <button className="link-btn mp-open-entity" onClick={() => onOpenEntity(r.person.id)}>
                  Kişiyi aç →
                </button>
                <Detail id={r.id} loader={detail} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
