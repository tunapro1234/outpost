// Gönderilen maillerin sağlam kaydı. Ayrı DB motoru yok; mevcut JSONL/vault
// felsefesine uygun olarak kanonik mail kaydı DÖRT kaynağı join ederek kurulur:
//   1. outbox.jsonl          → mailin kendisi + üretim provenance'ı (model/prompt/zaman)
//   2. mails/tracking.jsonl  → token kaydı (linkler, kişi)
//   3. mails/events.jsonl    → açılma/tıklama/bounce olayları
//   4. ingested inbound mail → reply eşleşmesi (kişiden gönderim sonrası gelen)
// Amaç: her mailin içeriğini, hakkında track edilen her şeyi ve nasıl üretildiğini
// tek kayıtta görüp reply-rate'e göre optimize edebilmek.
import { readOutbox } from "./drafts.mjs";
import {
  readTrackingRecords,
  readTrackingEvents,
  eventsByToken,
  summarizeEvents,
} from "./tracking.mjs";
import { ingestedWorkspaceMails } from "../mail/service.mjs";

function millis(value) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : null;
}

function replyIndex(inbound) {
  // person_id → gönderim sonrası gelen inbound tarihleri (artan).
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

// Tek kanonik mail kaydı. `full` false ise büyük alanlar (prompt/context/body)
// kırpılır (liste görünümü); true ise her şey döner (detay görünümü).
function buildRecord(outbox, { tracking, events, personReplies, index, full }) {
  const generation = outbox.generation ?? null;
  const person = index?.entities.get(outbox.person_id);
  const company = outbox.company_id ? index?.entities.get(outbox.company_id) : null;
  const summary = summarizeEvents(events);
  const sinceMs = millis(outbox.sent_at ?? outbox.approved_at);
  const reply = matchReply(personReplies, sinceMs);
  const sent = outbox.sent === true;

  const record = {
    id: outbox.id,
    token: outbox.track_token ?? null,
    person: { id: outbox.person_id, name: person?.meta.name ?? outbox.person_id },
    company: outbox.company_id
      ? { id: outbox.company_id, name: company?.meta.name ?? outbox.company_id }
      : { id: null, name: null },
    to: outbox.to ?? tracking?.mail ?? person?.meta.mail ?? null,
    subject: outbox.subject ?? null,
    tone: outbox.variant_tone ?? outbox.tone ?? null,
    variant: outbox.variant ?? null,
    score: outbox.queue_score ?? outbox.score ?? null,
    followup_stage: outbox.followup_stage ?? 0,
    author: outbox.author ?? null,
    created_at: outbox.created_at ?? null,
    approved_at: outbox.approved_at ?? null,
    sent,
    sent_at: outbox.sent_at ?? null,
    // Üretim provenance'ı (özet; tam prompt/context detay görünümünde).
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
      status: sent ? summary.status ?? "sent" : summary.status ?? "queued",
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

  if (full) {
    record.body = outbox.body ?? null;
    record.rationale = outbox.rationale ?? null;
    record.variants_all = outbox.variants_all ?? null;
    record.reasons = outbox.reasons ?? null;
    record.pixel_url = outbox.pixel_url ?? null;
    record.click_urls = outbox.click_urls ?? null;
    record.generation_full = generation;
    record.events = events;
  }
  return record;
}

async function loadSources(workspace) {
  const [outbox, trackingRecords, events, inbound] = await Promise.all([
    readOutbox(workspace),
    readTrackingRecords(workspace),
    readTrackingEvents(workspace),
    ingestedWorkspaceMails(workspace).catch(() => []),
  ]);
  const trackingByToken = new Map(trackingRecords.map((entry) => [entry.token, entry]));
  const eventMap = eventsByToken(events);
  const replies = replyIndex(inbound);
  const approved = outbox.filter((record) => record.approved === true);
  return { approved, trackingByToken, eventMap, replies };
}

export async function buildMailRecords(workspace, { full = false } = {}) {
  const { approved, trackingByToken, eventMap, replies } = await loadSources(workspace);
  const records = approved.map((outbox) => buildRecord(outbox, {
    tracking: outbox.track_token ? trackingByToken.get(outbox.track_token) : null,
    events: outbox.track_token ? eventMap.get(outbox.track_token) ?? [] : [],
    personReplies: replies.get(outbox.person_id),
    index: workspace.index,
    full,
  }));
  records.sort((left, right) =>
    String(right.approved_at ?? "").localeCompare(String(left.approved_at ?? "")));
  return records;
}

export async function mailRecord(workspace, id) {
  const { approved, trackingByToken, eventMap, replies } = await loadSources(workspace);
  const outbox = approved.find((record) => record.id === id);
  if (!outbox) return null;
  return buildRecord(outbox, {
    tracking: outbox.track_token ? trackingByToken.get(outbox.track_token) : null,
    events: outbox.track_token ? eventMap.get(outbox.track_token) ?? [] : [],
    personReplies: replies.get(outbox.person_id),
    index: workspace.index,
    full: true,
  });
}

// --- analytics: reply-rate kırılımları ---

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
  if (time === null) return null;
  return new Date(time).getUTCHours();
}

function weekdayOf(value) {
  const time = millis(value);
  if (time === null) return null;
  return ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"][new Date(time).getUTCDay()];
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
    key,
    n: cell.n,
    delivered: cell.delivered,
    opened: cell.opened,
    clicked: cell.clicked,
    replied: cell.replied,
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

export async function mailAnalytics(workspace) {
  const records = await buildMailRecords(workspace, { full: false });
  const overall = emptyCell();
  for (const record of records) accumulate(overall, record);
  const openedRecords = records.filter((record) => record.tracking.open_count > 0);
  const repliesWithTime = records
    .filter((record) => record.reply.replied && Number.isFinite(record.reply.time_to_reply_ms))
    .map((record) => record.reply.time_to_reply_ms)
    .sort((a, b) => a - b);
  const medianTtr = repliesWithTime.length
    ? repliesWithTime[Math.floor(repliesWithTime.length / 2)]
    : null;
  return {
    overall: {
      ...finalizeCell("overall", overall),
      // Açan kişiler arasında reply oranı — huni sinyali.
      reply_rate_given_open: rate(
        openedRecords.filter((record) => record.reply.replied).length,
        openedRecords.length,
      ),
      median_time_to_reply_ms: medianTtr,
    },
    by_model: breakdown(records, (record) => record.generation?.model ?? "bilinmiyor"),
    by_engine: breakdown(records, (record) => record.generation?.engine ?? "bilinmiyor"),
    by_tone: breakdown(records, (record) => record.tone ?? "bilinmiyor"),
    by_author: breakdown(records, (record) => record.author ?? "bilinmiyor"),
    by_followup: breakdown(records, (record) => `f${record.followup_stage ?? 0}`),
    by_score: breakdown(records, (record) => scoreBucket(record.score)),
    by_subject_length: breakdown(records, (record) => subjectBucket(record.subject)),
    by_hour: breakdown(records, (record) => {
      const hour = hourOf(record.approved_at);
      return hour === null ? null : `${String(hour).padStart(2, "0")}:00`;
    }),
    by_weekday: breakdown(records, (record) => weekdayOf(record.approved_at)),
    total: records.length,
  };
}
