import { useEffect, useRef, useState } from "react";
import type { MailImportItem } from "@/core/types";
import { api } from "@/core/api";
import { useMailSettings } from "./useMailSettings";

// Mail → Settings. Workspace outreach controls (approval threshold, daily cap,
// follow-up gap), a read-only dispatch-mode status, plus calibration reset and a
// JSON mail import. Each field commits on blur, sending only the changed value.
export default function MailSettings() {
  const s = useMailSettings();
  const { settings, notice, dismissNotice } = s;

  if (s.loading) {
    return <div className="ms-loading">Ayarlar yükleniyor…</div>;
  }
  if (!settings) {
    return (
      <div className="empty-state">
        <div className="es-title">Ayar servisi hazırlanıyor</div>
        <div className="es-sub">
          Mail ayarlarına şu an ulaşılamıyor. Birazdan tekrar dene.
        </div>
      </div>
    );
  }

  return (
    <div className="ms-wrap">
      <section className="ms-card">
        <div className="ms-card-title">Gönderim kuralları</div>

        <NumberRow
          label="Mail yazma skor eşiği"
          help="Bu skorun altındaki kişilere taslak yazılmaz. 0–100 arası."
          value={settings.approval_threshold}
          min={0}
          max={100}
          range
          suffix=""
          onCommit={(v) =>
            v !== settings.approval_threshold &&
            s.save({ approval_threshold: v })
          }
        />

        <NumberRow
          label="Günlük max gönderim"
          help="Mailler hazır olsa bile günde en fazla bu kadar gider. 0 = sınırsız."
          value={settings.daily_max_sends}
          min={0}
          max={9999}
          onCommit={(v) =>
            v !== settings.daily_max_sends && s.save({ daily_max_sends: v })
          }
        />

        <NumberRow
          label="Follow-up süresi (gün)"
          help="Cevap gelmezse bir sonraki takip mailine kaç gün sonra geçileceği."
          value={settings.followup_gap_days}
          min={1}
          max={30}
          onCommit={(v) =>
            v !== settings.followup_gap_days && s.save({ followup_gap_days: v })
          }
        />

        <div className="ms-row">
          <div className="ms-row-main">
            <div className="ms-label">Gönderim modu</div>
            <div className="ms-help">
              Gerçek gönderim ayrı bir onayla açılır — buradan değiştirilemez.
            </div>
          </div>
          <div className="ms-row-ctrl">
            <span
              className={`ms-mode ${
                settings.dispatch_mode === "brevo" ? "live" : "dry"
              }`}
            >
              {settings.dispatch_mode === "brevo"
                ? "brevo — canlı gönderim"
                : "dry-run — dışarı gönderilmiyor"}
            </span>
          </div>
        </div>
      </section>

      <CalibrationResetCard
        onDone={() => s.showNotice("Kalibrasyon sıfırlandı")}
        onError={(m) => s.showNotice(m)}
      />

      <ImportCard
        onDone={(r) =>
          s.showNotice(
            `İçe aktarıldı: ${r.imported} · kişi eşleşti: ${r.matched_person} · şirket eşleşti: ${r.matched_company} · atlanan: ${r.skipped}`
          )
        }
        onError={(m) => s.showNotice(m)}
      />

      {notice && (
        <div
          className="control-toast md-notice"
          role="status"
          aria-live="polite"
          onClick={dismissNotice}
        >
          {notice}
        </div>
      )}
    </div>
  );
}

// A labelled numeric control that commits on blur / Enter. Keeps its own text
// state so intermediate typing never fires a PUT; clamps to [min,max] on commit.
function NumberRow({
  label,
  help,
  value,
  min,
  max,
  range,
  suffix,
  onCommit,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  range?: boolean;
  suffix?: string;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    onCommit(clamped);
  };

  return (
    <div className="ms-row">
      <div className="ms-row-main">
        <div className="ms-label">{label}</div>
        <div className="ms-help">{help}</div>
      </div>
      <div className="ms-row-ctrl">
        {range && (
          <input
            className="ms-range"
            type="range"
            min={min}
            max={max}
            value={Number(text) || 0}
            onChange={(e) => setText(e.target.value)}
            onMouseUp={commit}
            onKeyUp={(e) => e.key === "Enter" && commit()}
          />
        )}
        <input
          className="np-input sm ms-num"
          type="number"
          min={min}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        {suffix ? <span className="ms-suffix">{suffix}</span> : null}
      </div>
    </div>
  );
}

function CalibrationResetCard({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (
      !window.confirm(
        "Mail sesi kalibrasyonun sıfırlanacak. Bu işlem geri alınamaz. Devam?"
      )
    )
      return;
    setBusy(true);
    try {
      await api.resetMailCalibration();
      onDone();
    } catch (e) {
      onError((e as Error)?.message ?? "Sıfırlama başarısız");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ms-card">
      <div className="ms-card-title">Kalibrasyon</div>
      <div className="ms-row">
        <div className="ms-row-main">
          <div className="ms-label">Kalibrasyonu sıfırla</div>
          <div className="ms-help">
            Öğrenilmiş mail ses dosyanı temizler; yazar sıfırdan öğrenmeye başlar.
          </div>
        </div>
        <div className="ms-row-ctrl">
          <button className="btn ghost sm" disabled={busy} onClick={reset}>
            {busy ? "Sıfırlanıyor…" : "Sıfırla"}
          </button>
        </div>
      </div>
    </section>
  );
}

// Parse a JSON array of mail objects and POST it. Accepts a picked .json file or
// a pasted array. Reports parse errors calmly via the toast.
function ImportCard({
  onDone,
  onError,
}: {
  onDone: (r: {
    imported: number;
    skipped: number;
    matched_person: number;
    matched_company: number;
    total: number;
  }) => void;
  onError: (msg: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parse = (raw: string): MailImportItem[] => {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("JSON bir dizi olmalı");
    return data as MailImportItem[];
  };

  const submit = async (mails: MailImportItem[]) => {
    if (mails.length === 0) {
      onError("Boş dizi — içe aktarılacak mail yok");
      return;
    }
    setBusy(true);
    try {
      const r = await api.importMails({ mails });
      onDone(r);
      setText("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      onError((e as Error)?.message ?? "İçe aktarma başarısız");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      await submit(parse(raw));
    } catch (err) {
      onError((err as Error)?.message ?? "Dosya okunamadı / geçersiz JSON");
    }
  };

  const onPaste = async () => {
    let mails: MailImportItem[];
    try {
      mails = parse(text);
    } catch (err) {
      onError((err as Error)?.message ?? "Geçersiz JSON");
      return;
    }
    await submit(mails);
  };

  return (
    <section className="ms-card">
      <div className="ms-card-title">Mailleri içe aktar</div>
      <div className="ms-help ms-help-block">
        Geçmiş mailleri kişilere/şirketlere bağlar. Şimdilik JSON dizi; gerçek
        döküm formatı gelince genişletilecek.
      </div>

      <div className="ms-import-actions">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="ms-file"
          onChange={onFile}
          disabled={busy}
        />
      </div>

      <textarea
        className="np-input ms-import-text"
        rows={5}
        spellCheck={false}
        placeholder='[{"to":"a@b.com","subject":"…","body":"…","person":"Ad Soyad","company":"Firma"}]'
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="ms-import-foot">
        <button
          className="btn primary sm"
          disabled={busy || text.trim() === ""}
          onClick={onPaste}
        >
          {busy ? "Aktarılıyor…" : "İçe aktar"}
        </button>
      </div>
    </section>
  );
}
