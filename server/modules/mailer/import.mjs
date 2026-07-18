// Var olan / insan-yazımı maillerin içeri alınması. compec gibi bir korpustan gelen
// mail dökümünü, gönderilmiş mail kayıtlarına çevirip şirket + kişi entity'lerine
// bağlar ve INSAN-YAZIMI olduğunu işaretler (source=imported, authored_by=human) —
// böylece analytics'te AI-üretimi maillerle karışmaz.
//
// Girdi ŞU AN generic: her kayıt { to, from, subject, body, date, company, person,
// author, message_id } alanlarından işine yarayanları taşır. Gerçek döküm formatı
// (mbox/maildir/CSV/JSON) netleşince önüne o formatı bu generic şekle çeviren ince
// bir parser eklenir; bu fonksiyon aynı kalır.
import { insertMail, scheduleSend, markSend, sendsByMail } from "./store.mjs";
import { mailEntityIndex } from "../network/service.mjs";
import { appendIngestedMailLog } from "../mail/service.mjs";
import { resolveEmployer } from "./service.mjs";
import { normalizeSearch } from "../../lib/slug.mjs";

function nameIndex(index) {
  const map = new Map();
  for (const entity of index?.entities?.values() ?? []) {
    const key = normalizeSearch(entity.meta?.name ?? "");
    if (key && !map.has(key)) map.set(key, entity);
  }
  return map;
}

function normalizeDate(value, now) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : now().toISOString();
}

// İçerikten kararlı id — aynı maili iki kez import etmek çift kayıt üretmesin.
function stableId(record, at) {
  const basis = `${record.message_id ?? ""}|${record.to ?? ""}|${record.subject ?? ""}|${at}`;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < basis.length; i += 1) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `import--${(hash >>> 0).toString(16)}`;
}

function firstAddress(value) {
  const match = /[\w.+-]+@[\w.-]+\.\w+/u.exec(String(value ?? ""));
  return match ? match[0].toLowerCase() : null;
}

// Dökümde yanıt/başarı bilgisi (replied / reply_date) varsa: bunu SENTETİK bir
// inbound kaydına çevirip ingested log'a ekleriz. Böylece mevcut reply-matching
// bu maili "yanıt aldı" sayar ve analytics'e (reply-rate by_source) akar —
// yanıtlar posta kutusunda olmasa bile korpustan "neyin çalıştığını" öğreniriz.
function syntheticReply(record, person, sentAtIso, now) {
  const replied = record.replied === true || record.reply === true ||
    Boolean(record.reply_date ?? record.replied_at ?? record.reply_at);
  if (!replied || !person) return null;
  const personAddr = person.meta?.mail
    ?? (Array.isArray(person.meta?.mails) ? person.meta.mails[0] : null);
  if (!personAddr) return null;
  // Yanıt tarihi: verilmişse o, yoksa gönderimden hemen sonra (best-effort).
  const rawReplyDate = record.reply_date ?? record.replied_at ?? record.reply_at;
  const replyMs = Date.parse(String(rawReplyDate ?? ""));
  const sentMs = Date.parse(sentAtIso);
  const date = Number.isFinite(replyMs)
    ? new Date(Math.max(replyMs, sentMs + 1000)).toISOString()
    : new Date(sentMs + 60_000).toISOString();
  let hash = 2166136261 >>> 0;
  for (const ch of `${personAddr}|${sentAtIso}`) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return {
    id: `import-reply-${(hash >>> 0).toString(16)}`,
    account: "import",
    direction: "received",
    peer: [personAddr],
    subject: record.reply_subject ?? `Re: ${record.subject ?? ""}`.trim(),
    date,
    folder: "Inbox",
  };
}

export async function importMails(workspace, records, { now = () => new Date(), defaultAuthor = "human" } = {}) {
  if (!Array.isArray(records)) {
    const error = new Error("mails bir dizi olmalı");
    error.statusCode = 400;
    throw error;
  }
  const addrIndex = mailEntityIndex(workspace.index);
  const byName = nameIndex(workspace.index);

  let imported = 0;
  let skipped = 0;
  let matchedPerson = 0;
  let matchedCompany = 0;
  let replies = 0;
  const syntheticReplies = [];

  for (const record of records) {
    if (!record || typeof record !== "object") { skipped += 1; continue; }
    const toAddr = record.to ?? record.to_addr ?? null;
    const at = normalizeDate(record.date ?? record.sent_at ?? record.approved_at, now);

    // Kişi: önce alıcı adresinden, sonra isimden eşle.
    const person =
      addrIndex.get(firstAddress(toAddr) ?? "") ??
      (record.person ? byName.get(normalizeSearch(record.person)) : null) ??
      null;
    // Şirket: isimden eşle, yoksa kişinin işvereninden çöz.
    let company = record.company ? byName.get(normalizeSearch(record.company)) : null;
    if (!company && person) company = resolveEmployer(person, workspace.index).company;
    if (person) matchedPerson += 1;
    if (company) matchedCompany += 1;

    const id = stableId(record, at);
    const author = record.author ?? defaultAuthor;
    insertMail(workspace, {
      id,
      person_id: person?.id ?? null,
      company_id: company?.id ?? null,
      to_addr: firstAddress(toAddr) ?? toAddr ?? person?.meta?.mail ?? null,
      subject: record.subject ?? null,
      body: record.body ?? record.text ?? null,
      author,
      source: "imported",
      authored_by: author,
      created_at: at,
      approved_at: at,
    });
    // Zaten import edilmişse (kararlı id) ikinci bir send kaydı açma.
    if (!sendsByMail(workspace, id).length) {
      const sendId = scheduleSend(workspace, {
        mail_id: id, scheduled_at: at, dispatch_mode: "imported", status: "sent",
      });
      markSend(workspace, sendId, { status: "sent", sent_at: at });
    }
    // Dökümde yanıt bilgisi varsa: başarı sinyali olarak sentetik inbound.
    const reply = syntheticReply(record, person, at, now);
    if (reply) { syntheticReplies.push(reply); replies += 1; }
    imported += 1;
  }

  // Sentetik yanıtları ingested log'a ekle (dedup + şema doğrulaması orada).
  if (syntheticReplies.length) {
    await appendIngestedMailLog(workspace, syntheticReplies).catch(() => {});
  }

  return {
    imported, skipped,
    matched_person: matchedPerson,
    matched_company: matchedCompany,
    replies,
    total: records.length,
  };
}
