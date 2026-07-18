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

// Human duration for engagement latencies (open/reply take minutes to days).
function dur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const m = Math.round(value / 60000);
  if (m < 60) return `${m} dk`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} sa`;
  return `${Math.round(h / 24)} gün`;
}

const SEND_LABEL: Record<string, string> = {
  scheduled: "planlandı",
  sending: "gönderiliyor",
  sent_dryrun: "dry-run",
  sent: "gönderildi",
  canceled: "iptal (cevap geldi)",
  failed: "başarısız",
  unsent: "beklemede",
  queued: "kuyrukta",
};

// Reliability flags: honest read of a noisy channel. "replied w/o open" means
// the mail worked even though open tracking missed it; "cold" means it did not
// land at all after maturing.
function FlagChips({ r }: { r: MailRecord }) {
  const chips: { k: string; label: string; cls: string; title: string }[] = [];
  if (r.flags.replied_without_open)
    chips.push({ k: "rwo", label: "açılmadan yanıt", cls: "flag-good", title: "Yanıt geldi ama açılma görünmedi — mail çalıştı, open tracking kaçırdı" });
  if (r.flags.cold)
    chips.push({ k: "cold", label: "tutmadı", cls: "flag-cold", title: "Olgunlaştı, hiç açılma/yanıt yok" });
  if (r.flags.opened_no_reply)
    chips.push({ k: "onr", label: "açıldı, yanıt yok", cls: "flag-warn", title: "Açıldı ama yanıt gelmedi — içerik/CTA zayıf olabilir" });
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <span key={c.k} className={`flag-chip ${c.cls}`} title={c.title}>{c.label}</span>
      ))}
    </>
  );
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
          <Field k="Açılma süresi" v={dur(detail.durations.time_to_open_ms)} />
          <Field k="Yanıt süresi" v={dur(detail.durations.time_to_reply_ms)} />
          {(detail.flags.replied_without_open || detail.flags.cold || detail.flags.opened_no_reply) ? (
            <div className="mp-flags"><FlagChips r={detail} /></div>
          ) : null}
        </section>

        <section className="mp-sec">
          <h4>Gönderim</h4>
          <Field k="Durum" v={SEND_LABEL[detail.send.status] ?? detail.send.status} />
          <Field
            k="Planlanan saat"
            v={
              detail.send.scheduled_at
                ? `${new Date(detail.send.scheduled_at).toLocaleString("tr-TR")}${detail.send.window_reason ? ` · ${detail.send.window_reason}` : ""}`
                : "—"
            }
          />
          <Field
            k="Mod"
            v={
              detail.send.dispatch_mode === "brevo"
                ? "brevo (canlı)"
                : "dry-run — dışarı gönderilmedi"
            }
          />
          {detail.rendered?.message_id ? <Field k="Message-ID" v={<code>{detail.rendered.message_id}</code>} /> : null}
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
  const live = records.some((r) => r.send.dispatch_mode === "brevo");
  return (
    <div className="sent-wrap">
      <div className={`dryrun-banner ${live ? "live" : ""}`}>
        {live
          ? "Canlı gönderim (brevo) açık — mailler planlanan saatlerinde gerçekten gönderiliyor."
          : "Dry-run: mailler alıcı saatine göre planlanıyor ama DIŞARI GÖNDERİLMİYOR. Gerçek gönderim ayrı, açık bir onayla açılır."}
      </div>
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
              <FlagChips r={r} />
              {r.generation?.model ? <span className="mp-model-tag">{r.generation.model}</span> : null}
              {r.send.status === "scheduled" && r.send.scheduled_at ? (
                <span className="send-chip" title={r.send.window_reason ?? ""}>
                  ⧗ {new Date(r.send.scheduled_at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              ) : r.send.status && r.send.status !== "unsent" ? (
                <span className="send-chip">{SEND_LABEL[r.send.status] ?? r.send.status}</span>
              ) : null}
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
    </div>
  );
}
