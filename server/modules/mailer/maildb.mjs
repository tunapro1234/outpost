// Gönderilen maillerin kanonik kaydı — artık SQLite'tan (store) okunur. Her mail
// için: içeriği + üretim provenance'ı (store.mail) + gönderim/schedule durumu
// (store.mail_send) + açılma/tıklama olayları (store.mail_event) + reply eşleşmesi
// (vault inbound) + süre/güvenilirlik işaretleri (reliability). Amaç: reply-rate'e
// göre optimize etmek, open'ın gürültüsüne aldanmadan.
import { listMails, mailById, sendsByMail, eventsByToken } from "./store.mjs";
import { summarizeEvents } from "./tracking.mjs";
import { ingestedWorkspaceMails } from "../mail/service.mjs";
import { withReliability } from "./reliability.mjs";
import { readMailSettings } from "./settings.mjs";

function millis(value) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : null;
}

function replyIndex(inbound) {
  const byPerson = new Map();
  for (const mail of inbound) {
    if (mail.direction !== "in" || !mail.person_id) continue;
    const at = millis(mail.date);
    if (at === null) continue;
    if (!byPerson.has(mail.person_id)) byPerson.set(mail.person_id, []);
    byPerson.get(mail.person_id).push({ at, subject: mail.subject ?? null, id: mail.id });
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.at - b.at);
  return byPerson;
}

function matchReply(personReplies, sinceMs) {
  if (!personReplies || sinceMs === null) return { replied: false };
  const after = personReplies.filter((reply) => reply.at >= sinceMs);
  if (!after.length) return { replied: false };
  const first = after[0];
  return {
    replied: true,
    reply_at: new Date(first.at).toISOString(),
    reply_count: after.length,
    reply_subject: first.subject,
    time_to_reply_ms: first.at - sinceMs,
  };
}

function clickBreakdown(events) {
  const byIndex = new Map();
  for (const event of events) {
    if (event.type !== "click") continue;
    const key = Number.isInteger(event.link_index) ? event.link_index : 0;
    const entry = byIndex.get(key) ?? { link_index: key, url: event.url ?? null, count: 0 };
    entry.count += 1;
    if (event.url) entry.url = event.url;
    byIndex.set(key, entry);
  }
  return [...byIndex.values()].sort((a, b) => a.link_index - b.link_index);
}

function latestSend(sends) {
  return sends.length ? sends[sends.length - 1] : null;
}

function buildRecord(mail, { events, sends, personReplies, index, coldAfterDays, now, full }) {
  const generation = mail.generation ?? null;
  const person = index?.entities.get(mail.person_id);
  const company = mail.company_id ? index?.entities.get(mail.company_id) : null;
  const summary = summarizeEvents(events);
  const send = latestSend(sends);
  const sendStatus = send?.status ?? "unsent";
  const sentAt = send?.sent_at ?? null;
  // Reply/süre referansı: gönderildiyse gönderim, yoksa onay zamanı.
  const sinceMs = millis(sentAt ?? mail.approved_at);
  const reply = matchReply(personReplies, sinceMs);

  const base = {
    id: mail.id,
    token: mail.track_token ?? null,
    person: { id: mail.person_id, name: person?.meta.name ?? mail.person_id },
    company: mail.company_id
      ? { id: mail.company_id, name: company?.meta.name ?? mail.company_id }
      : { id: null, name: null },
    to: mail.to_addr ?? null,
    subject: mail.subject ?? null,
    tone: mail.tone ?? null,
    variant: mail.variant ?? null,
    score: mail.score ?? null,
    followup_stage: mail.followup_stage ?? 0,
    author: mail.author ?? null,
    created_at: mail.created_at ?? null,
    approved_at: mail.approved_at ?? null,
    sent: sendStatus === "sent" || sendStatus === "sent_dryrun",
    sent_at: sentAt,
    send: {
      status: sendStatus,
      scheduled_at: send?.scheduled_at ?? null,
      window_reason: send?.window_reason ?? null,
      dispatch_mode: send?.dispatch_mode ?? null,
    },
    generation: generation
      ? {
          model: generation.model ?? null,
          engine: generation.engine ?? null,
          generated_at: generation.generated_at ?? null,
          generation_ms: generation.generation_ms ?? null,
          context_model: generation.context_model ?? null,
          context_ms: generation.context_ms ?? null,
          attempts: generation.attempts ?? null,
          usage: generation.usage ?? null,
          skills: generation.skills ?? null,
        }
      : null,
    tracking: {
      status: summary.status ?? (base_sentStatusLabel(sendStatus)),
      delivered: summary.delivered,
      bounced: summary.bounced,
      open_count: summary.open_count,
      proxy_open_count: summary.proxy_open_count,
      first_open: summary.first_open,
      last_open: summary.last_open,
      click_count: summary.click_count,
      last_click: summary.last_click,
      clicks: clickBreakdown(events),
    },
    reply,
  };

  const record = withReliability(base, { now, coldAfterDays });

  if (full) {
    record.body = mail.body ?? null;
    record.rationale = mail.rationale ?? null;
    record.variants_all = mail.variants ?? null;
    record.reasons = mail.reasons ?? null;
    record.generation_full = generation;
    record.events = events;
    record.rendered = send?.rendered ?? null;
  }
  return record;
}

// Olay yoksa engagement durumu, gönderim durumundan türetilir.
function base_sentStatusLabel(sendStatus) {
  if (sendStatus === "sent" || sendStatus === "sent_dryrun") return "sent";
  if (sendStatus === "scheduled") return "scheduled";
  if (sendStatus === "failed") return "failed";
  return "queued";
}

async function loadContext(workspace) {
  const [inbound, settings] = await Promise.all([
    ingestedWorkspaceMails(workspace).catch(() => []),
    readMailSettings(workspace),
  ]);
  return {
    replies: replyIndex(inbound),
    coldAfterDays: settings.cold_after_days,
  };
}

export async function buildMailRecords(workspace, { full = false, now = () => new Date() } = {}) {
  const { replies, coldAfterDays } = await loadContext(workspace);
  const records = listMails(workspace).map((mail) => buildRecord(mail, {
    events: mail.track_token ? eventsByToken(workspace, mail.track_token) : [],
    sends: sendsByMail(workspace, mail.id),
    personReplies: replies.get(mail.person_id),
    index: workspace.index,
    coldAfterDays,
    now,
    full,
  }));
  records.sort((left, right) =>
    String(right.approved_at ?? "").localeCompare(String(left.approved_at ?? "")));
  return records;
}

export async function mailRecord(workspace, id, { now = () => new Date() } = {}) {
  const mail = mailById(workspace, id);
  if (!mail) return null;
  const { replies, coldAfterDays } = await loadContext(workspace);
  return buildRecord(mail, {
    events: mail.track_token ? eventsByToken(workspace, mail.track_token) : [],
    sends: sendsByMail(workspace, mail.id),
    personReplies: replies.get(mail.person_id),
    index: workspace.index,
    coldAfterDays,
    now,
    full: true,
  });
}

// --- analytics: reply-rate kırılımları + güvenilirlik ---

function scoreBucket(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "bilinmiyor";
  if (score >= 90) return "90+";
  if (score >= 80) return "80-89";
  if (score >= 70) return "70-79";
  if (score >= 60) return "60-69";
  return "<60";
}

function subjectBucket(subject) {
  const length = String(subject ?? "").length;
  if (!length) return "boş";
  if (length <= 30) return "≤30";
  if (length <= 45) return "31-45";
  if (length <= 60) return "46-60";
  return "60+";
}

function hourOf(value) {
  const time = millis(value);
  return time === null ? null : new Date(time).getUTCHours();
}

function weekdayOf(value) {
  const time = millis(value);
  return time === null ? null : ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"][new Date(time).getUTCDay()];
}

function rate(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function emptyCell() {
  return { n: 0, delivered: 0, opened: 0, clicked: 0, replied: 0 };
}

function accumulate(cell, record) {
  cell.n += 1;
  if (record.tracking.delivered) cell.delivered += 1;
  if (record.tracking.open_count > 0) cell.opened += 1;
  if (record.tracking.click_count > 0) cell.clicked += 1;
  if (record.reply.replied) cell.replied += 1;
}

function finalizeCell(key, cell) {
  return {
    key, n: cell.n,
    delivered: cell.delivered, opened: cell.opened, clicked: cell.clicked, replied: cell.replied,
    open_rate: rate(cell.opened, cell.n),
    click_rate: rate(cell.clicked, cell.n),
    reply_rate: rate(cell.replied, cell.n),
  };
}

function breakdown(records, keyOf) {
  const cells = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (key === null || key === undefined) continue;
    if (!cells.has(key)) cells.set(key, emptyCell());
    accumulate(cells.get(key), record);
  }
  return [...cells.entries()]
    .map(([key, cell]) => finalizeCell(String(key), cell))
    .sort((a, b) => b.reply_rate - a.reply_rate || b.n - a.n);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function mailAnalytics(workspace, { now = () => new Date() } = {}) {
  const records = await buildMailRecords(workspace, { full: false, now });
  const overall = emptyCell();
  for (const record of records) accumulate(overall, record);
  const opened = records.filter((r) => r.tracking.open_count > 0);
  const tto = records.map((r) => r.durations.time_to_open_ms).filter((v) => Number.isFinite(v));
  const ttr = records.map((r) => r.durations.time_to_reply_ms).filter((v) => Number.isFinite(v));
  return {
    overall: {
      ...finalizeCell("overall", overall),
      reply_rate_given_open: rate(opened.filter((r) => r.reply.replied).length, opened.length),
      median_time_to_open_ms: median(tto),
      median_time_to_reply_ms: median(ttr),
      // Güvenilirlik: open patlamış ama çalışmış / hiç tutmamış.
      replied_without_open: records.filter((r) => r.flags.replied_without_open).length,
      cold: records.filter((r) => r.flags.cold).length,
      opened_no_reply: records.filter((r) => r.flags.opened_no_reply).length,
    },
    by_model: breakdown(records, (r) => r.generation?.model ?? "bilinmiyor"),
    by_engine: breakdown(records, (r) => r.generation?.engine ?? "bilinmiyor"),
    by_tone: breakdown(records, (r) => r.tone ?? "bilinmiyor"),
    by_author: breakdown(records, (r) => r.author ?? "bilinmiyor"),
    by_followup: breakdown(records, (r) => `f${r.followup_stage ?? 0}`),
    by_score: breakdown(records, (r) => scoreBucket(r.score)),
    by_subject_length: breakdown(records, (r) => subjectBucket(r.subject)),
    by_hour: breakdown(records, (r) => {
      const hour = hourOf(r.sent_at ?? r.approved_at);
      return hour === null ? null : `${String(hour).padStart(2, "0")}:00`;
    }),
    by_weekday: breakdown(records, (r) => weekdayOf(r.sent_at ?? r.approved_at)),
    total: records.length,
  };
}
