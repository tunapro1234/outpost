import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { ingestedWorkspaceMails } from "../mail/service.mjs";

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mailDedupKey(mail) {
  return [
    clean(mail.entity_id) ?? "",
    clean(mail.date) ?? "",
    clean(mail.direction) ?? "",
    clean(mail.summary) ?? "",
  ].join("\0");
}

export function mailId(mail) {
  return `mail-${createHash("sha256").update(mailDedupKey(mail)).digest("hex").slice(0, 16)}`;
}

export async function readMailLog(filePath) {
  if (!filePath) return [];
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const records = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error("kayıt nesne değil");
      }
      if (
        typeof record.id !== "string" ||
        typeof record.entity_id !== "string" ||
        !["in", "out"].includes(record.direction) ||
        typeof record.date !== "string" ||
        typeof record.summary !== "string" ||
        !["import", "vault", "manual"].includes(record.source)
      ) {
        throw new Error("mail log şemasına uymuyor");
      }
      records.push(record);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error.message}`);
    }
  }
  return records;
}

export function vaultMailRecords(index, { allEntities = false } = {}) {
  const records = [];
  for (const entity of index.entities.values()) {
    if (!allEntities && entity.meta.type !== "person") continue;
    for (const mail of entity.mails) {
      const record = {
        entity_id: entity.id,
        direction: mail.direction,
        date: mail.date,
        from: null,
        to: clean(entity.meta.mail),
        subject: null,
        summary: mail.summary,
        source: "vault",
        raw: mail.raw,
      };
      if (entity.meta.type === "person") record.person_id = entity.id;
      record.id = mailId(record);
      records.push(record);
    }
  }
  return records;
}

function enrich(record, index) {
  const entity = index.entities.get(record.entity_id);
  const person = record.person_id ? index.entities.get(record.person_id) : null;
  return {
    ...record,
    entity_name: entity?.meta.name ?? null,
    ...(record.person_id
      ? { person_name: person?.meta.name ?? null }
      : {}),
  };
}

function compareMails(left, right) {
  if (left.date === null && right.date === null) return 0;
  if (left.date === null) return 1;
  if (right.date === null) return -1;
  return String(right.date).localeCompare(String(left.date));
}

function combinedMailKey(record) {
  return record.id?.startsWith("maildir:") ? `maildir\0${record.id}` : mailDedupKey(record);
}

export async function workspaceMails(workspace, { includeUnknownVault = false } = {}) {
  const vault = vaultMailRecords(workspace.index)
    .filter((mail) => includeUnknownVault || ["in", "out"].includes(mail.direction));
  const combined = [
    ...await workspaceTrafficMails(workspace),
    ...vault,
  ];
  const byKey = new Map();
  for (const record of combined) {
    const key = combinedMailKey(record);
    if (!byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()]
    .map((record) => enrich(record, workspace.index))
    .sort(compareMails);
}

export async function workspaceTrafficMails(workspace) {
  const combined = [
    ...await readMailLog(workspace.mailsPath),
    ...await ingestedWorkspaceMails(workspace),
  ];
  const byKey = new Map();
  for (const record of combined) {
    const key = combinedMailKey(record);
    if (!byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()].sort(compareMails);
}

export function mailStats(mails) {
  const byEntity = new Map();
  for (const mail of mails) {
    if (!mail.entity_id || !["in", "out"].includes(mail.direction)) continue;
    let stats = byEntity.get(mail.entity_id);
    if (!stats) {
      stats = {
        mail_count: 0,
        last_mail_date: null,
        last_mail_direction: null,
        last_mail_from: null,
      };
      byEntity.set(mail.entity_id, stats);
    }
    stats.mail_count += 1;
    if (mail.date && (!stats.last_mail_date || mail.date > stats.last_mail_date)) {
      stats.last_mail_date = mail.date;
      stats.last_mail_direction = mail.direction;
      stats.last_mail_from = clean(mail.from);
    }
  }
  return byEntity;
}

export function emptyMailStats() {
  return {
    mail_count: 0,
    last_mail_date: null,
    last_mail_direction: null,
    last_mail_from: null,
  };
}
