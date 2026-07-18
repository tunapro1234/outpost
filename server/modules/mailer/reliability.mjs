// Mail etkileşim süreleri + güvenilirlik işaretleri. SAF fonksiyonlar.
// Açılma (open) güvenilir DEĞİL: proxy önden-yükleme sahte pozitif, görsel
// engelleme sahte negatif üretir. Bu yüzden iki özel durumu açıkça işaretleriz:
//   - replied_without_open: açılma görünmedi ama YANIT geldi → mail çalıştı,
//     open tracking patladı (bu maili "açılmadı" diye kötü sayma).
//   - cold: yeterli süre geçti, ne gerçek açılma ne yanıt var → mail tutmadı.
// Böylece reply-rate optimizasyonunda open'ın gürültüsüne aldanmayız.

const DAY_MS = 24 * 60 * 60 * 1000;

function millis(value) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : null;
}

// Gönderim referans zamanı: sent_at varsa o, yoksa approved_at.
function baselineMs(record) {
  return millis(record.sent_at) ?? millis(record.approved_at);
}

export function timeToOpenMs(record) {
  const base = baselineMs(record);
  const open = millis(record?.tracking?.first_open);
  if (base === null || open === null || open < base) return null;
  return open - base;
}

export function timeToReplyMs(record) {
  const base = baselineMs(record);
  const reply = millis(record?.reply?.reply_at);
  if (base === null || reply === null || reply < base) return null;
  return reply - base;
}

export function reliabilityFlags(record, { now = () => new Date(), coldAfterDays = 5 } = {}) {
  const tracking = record?.tracking ?? {};
  const replied = record?.reply?.replied === true;
  const humanOpen = (tracking.open_count ?? 0) > 0;
  const anyOpen = humanOpen || (tracking.proxy_open_count ?? 0) > 0;
  const base = baselineMs(record);
  const ageMs = base === null ? null : now().getTime() - base;
  const matured = ageMs !== null && ageMs >= coldAfterDays * DAY_MS;

  return {
    // Açılmadan (gerçek open yok) yanıt geldi → mail çalıştı, open ölçümü kaçırdı.
    replied_without_open: replied && !humanOpen,
    // Olgunlaşmış ama hiç etkileşim yok (ne açılma ne yanıt) → tutmadı.
    cold: matured && !anyOpen && !replied,
    // Açıldı ama yanıt yok (olgun) → içerik/CTA zayıf olabilir.
    opened_no_reply: matured && humanOpen && !replied,
  };
}

// Bir kayda süre + işaretleri ekleyen yardımcı (maildb kullanır).
export function withReliability(record, options = {}) {
  return {
    ...record,
    durations: {
      time_to_open_ms: timeToOpenMs(record),
      time_to_reply_ms: timeToReplyMs(record),
    },
    flags: reliabilityFlags(record, options),
  };
}
