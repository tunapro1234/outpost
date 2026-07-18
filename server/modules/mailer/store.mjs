// SQLite-backed store for the mailer: entity mirror, mail lifecycle, events,
// followups, and a one-time legacy JSONL importer. JSON columns are stored via
// JSON.stringify and parsed on read.
import { promises as fs } from "node:fs";
import path from "node:path";
import { openWorkspaceDb } from "../../lib/db.mjs";

function nowIso(now) {
  return (typeof now === "function" ? now() : new Date()).toISOString();
}

function toJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function fromJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entities mirror
// ---------------------------------------------------------------------------
export function syncEntities(workspace, { now = () => new Date() } = {}) {
  const db = openWorkspaceDb(workspace);
  const stamp = nowIso(now);
  const index = workspace.index ?? {};
  const entities = index.entities instanceof Map ? [...index.entities.values()] : [];
  const edges = Array.isArray(index.edges) ? index.edges : [];

  const insertEntity = db.prepare(
    `INSERT INTO entity (id, type, name, city, subtype, mail, score, meta_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO edge (source, target, label, meta_json) VALUES (?, ?, ?, ?)`,
  );

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM entity");
    db.exec("DELETE FROM edge");
    let entityCount = 0;
    for (const entity of entities) {
      const meta = entity.meta ?? {};
      const mail =
        meta.mail ?? (Array.isArray(meta.mails) ? meta.mails[0] ?? null : null);
      insertEntity.run(
        entity.id,
        meta.type ?? null,
        meta.name ?? null,
        meta.city ?? null,
        meta.subtype ?? null,
        mail ?? null,
        meta.score ?? null,
        JSON.stringify(meta),
        stamp,
      );
      entityCount += 1;
    }
    let edgeCount = 0;
    for (const edge of edges) {
      insertEdge.run(
        edge.source ?? null,
        edge.target ?? null,
        edge.label ?? null,
        JSON.stringify(edge),
      );
      edgeCount += 1;
    }
    db.exec("COMMIT");
    return { entities: entityCount, edges: edgeCount };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Mail lifecycle
// ---------------------------------------------------------------------------
function parseMailRow(row) {
  if (!row) return null;
  return {
    ...row,
    variants: fromJson(row.variants_json),
    reasons: fromJson(row.reasons_json),
    generation: fromJson(row.generation_json),
    links: fromJson(row.links_json),
  };
}

export function insertMail(workspace, row) {
  const db = openWorkspaceDb(workspace);
  db.prepare(
    `INSERT OR REPLACE INTO mail
       (id, draft_id, person_id, company_id, to_addr, subject, body, tone, variant,
        score, followup_stage, author, rationale, variants_json, reasons_json,
        generation_json, links_json, track_token, created_at, approved_at,
        source, authored_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.draft_id ?? null,
    row.person_id ?? null,
    row.company_id ?? null,
    row.to_addr ?? null,
    row.subject ?? null,
    row.body ?? null,
    row.tone ?? null,
    row.variant ?? null,
    row.score ?? null,
    row.followup_stage ?? 0,
    row.author ?? null,
    row.rationale ?? null,
    toJson(row.variants),
    toJson(row.reasons),
    toJson(row.generation),
    toJson(row.links),
    row.track_token ?? null,
    row.created_at ?? null,
    row.approved_at ?? null,
    // Varsayılan: bizim üretimimiz. Import edilenler explicit "imported"/"human".
    row.source ?? "generated",
    row.authored_by ?? null,
  );
  return row.id;
}

export function mailById(workspace, id) {
  const db = openWorkspaceDb(workspace);
  return parseMailRow(db.prepare("SELECT * FROM mail WHERE id = ?").get(id));
}

export function mailByToken(workspace, token) {
  const db = openWorkspaceDb(workspace);
  return parseMailRow(
    db.prepare("SELECT * FROM mail WHERE track_token = ?").get(token),
  );
}

export function listMails(workspace) {
  const db = openWorkspaceDb(workspace);
  const rows = db
    .prepare("SELECT * FROM mail ORDER BY approved_at DESC")
    .all();
  return rows.map(parseMailRow);
}

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------
function parseSendRow(row) {
  if (!row) return null;
  return { ...row, rendered: fromJson(row.rendered_json) };
}

export function scheduleSend(
  workspace,
  {
    mail_id,
    scheduled_at,
    window_reason = null,
    dispatch_mode = "dry_run",
    status = "scheduled",
  },
) {
  const db = openWorkspaceDb(workspace);
  const result = db
    .prepare(
      `INSERT INTO mail_send (mail_id, scheduled_at, window_reason, dispatch_mode, status)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(mail_id, scheduled_at, window_reason, dispatch_mode, status);
  return Number(result.lastInsertRowid);
}

export function dueSends(workspace, nowIsoValue, { limit = 100 } = {}) {
  const db = openWorkspaceDb(workspace);
  const rows = db
    .prepare(
      `SELECT * FROM mail_send
       WHERE status = 'scheduled' AND scheduled_at <= ?
       ORDER BY scheduled_at LIMIT ?`,
    )
    .all(nowIsoValue, limit);
  return rows.map(parseSendRow);
}

// Rolling hız-sınırı defteri: schedule.nextSendTime'a takenUtc olarak beslenir.
// Yalnız "scheduled" değil, ZATEN GÖNDERİLMİŞ (sent_dryrun/sent) sendleri de sayar —
// aksi halde bir saatteki 12 mail dispatch olunca limit "unutulur" ve aynı saate
// yeni mail sıkışabilirdi (GPT/Opus review bulgusu).
export function sendLedgerTimes(workspace) {
  const db = openWorkspaceDb(workspace);
  return db
    .prepare(
      `SELECT scheduled_at FROM mail_send
       WHERE status IN ('scheduled', 'sent_dryrun', 'sent') AND scheduled_at IS NOT NULL
       ORDER BY scheduled_at`,
    )
    .all()
    .map((row) => row.scheduled_at);
}

export function sendsByMail(workspace, mailId) {
  const db = openWorkspaceDb(workspace);
  const rows = db
    .prepare("SELECT * FROM mail_send WHERE mail_id = ? ORDER BY id")
    .all(mailId);
  return rows.map(parseSendRow);
}

export function markSend(workspace, sendId, patch = {}) {
  const db = openWorkspaceDb(workspace);
  const columns = [];
  const values = [];
  const map = {
    status: "status",
    sent_at: "sent_at",
    message_id: "message_id",
    error: "error",
    attempts: "attempts",
  };
  for (const [key, column] of Object.entries(map)) {
    if (key in patch) {
      columns.push(`${column} = ?`);
      values.push(patch[key]);
    }
  }
  if ("rendered" in patch) {
    columns.push("rendered_json = ?");
    values.push(toJson(patch.rendered));
  }
  if (!columns.length) return;
  values.push(sendId);
  db.prepare(`UPDATE mail_send SET ${columns.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function parseEventRow(row) {
  if (!row) return null;
  return { ...row, bot: Boolean(row.bot) };
}

export function insertEvent(workspace, row) {
  const db = openWorkspaceDb(workspace);
  const result = db
    .prepare(
      `INSERT INTO mail_event (token, type, source, bot, at, ua, ip, link_index, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.token ?? null,
      row.type ?? null,
      row.source ?? null,
      row.bot ? 1 : 0,
      row.at ?? null,
      row.ua ?? null,
      row.ip ?? null,
      row.link_index ?? null,
      row.url ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function eventsByToken(workspace, token) {
  const db = openWorkspaceDb(workspace);
  const rows = db
    .prepare("SELECT * FROM mail_event WHERE token = ? ORDER BY id")
    .all(token);
  return rows.map(parseEventRow);
}

export function allEvents(workspace) {
  const db = openWorkspaceDb(workspace);
  return db.prepare("SELECT * FROM mail_event ORDER BY id").all().map(parseEventRow);
}

// ---------------------------------------------------------------------------
// Followups
// ---------------------------------------------------------------------------
export function insertFollowup(
  workspace,
  { mail_id, person_id, stage, due_at, status = "pending" },
) {
  const db = openWorkspaceDb(workspace);
  const result = db
    .prepare(
      `INSERT INTO followup (mail_id, person_id, stage, due_at, status)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(mail_id, person_id, stage, due_at, status);
  return Number(result.lastInsertRowid);
}

export function dueFollowups(workspace, nowIsoValue) {
  const db = openWorkspaceDb(workspace);
  return db
    .prepare(
      `SELECT * FROM followup
       WHERE status = 'pending' AND due_at <= ?
       ORDER BY due_at`,
    )
    .all(nowIsoValue);
}

export function markFollowup(workspace, id, patch = {}) {
  const db = openWorkspaceDb(workspace);
  const columns = [];
  const values = [];
  for (const key of ["status", "due_at"]) {
    if (key in patch) {
      columns.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (!columns.length) return;
  values.push(id);
  db.prepare(`UPDATE followup SET ${columns.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

// ---------------------------------------------------------------------------
// Legacy importer (one-time backfill)
// ---------------------------------------------------------------------------
async function readJsonlLines(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed JSON lines defensively.
    }
  }
  return out;
}

export async function importLegacy(workspace) {
  const db = openWorkspaceDb(workspace);
  // Marker: mail VEYA event tablosunda veri varsa import zaten yapılmış say. Sadece
  // mail sayısına bakmak, event-only legacy verisini her açılışta yeniden import
  // ederdi (GPT review bulgusu #4).
  const mailN = Number(db.prepare("SELECT COUNT(*) AS n FROM mail").get()?.n ?? 0);
  const eventN = Number(db.prepare("SELECT COUNT(*) AS n FROM mail_event").get()?.n ?? 0);
  if (mailN > 0 || eventN > 0) return { imported: false };

  const mailsDir = path.join(workspace.directory, "mails");
  const outbox = await readJsonlLines(path.join(mailsDir, "outbox.jsonl"));
  const tracking = await readJsonlLines(path.join(mailsDir, "tracking.jsonl"));
  const events = await readJsonlLines(path.join(mailsDir, "events.jsonl"));

  const linksByToken = new Map();
  for (const record of tracking) {
    if (record && record.token) {
      linksByToken.set(record.token, record.links ?? null);
    }
  }

  let mailCount = 0;
  for (const line of outbox) {
    if (!line || line.approved !== true) continue;
    const token = line.track_token ?? null;
    insertMail(workspace, {
      id: line.id,
      draft_id: line.draft_id ?? null,
      person_id: line.person_id ?? null,
      company_id: line.company_id ?? null,
      to_addr: line.mail ?? null,
      subject: line.subject ?? null,
      body: line.body ?? null,
      tone: line.tone ?? line.variant_tone ?? null,
      variant: line.variant ?? null,
      score: line.score ?? line.queue_score ?? null,
      followup_stage: line.followup_stage ?? 0,
      author: line.author ?? null,
      rationale: line.rationale ?? null,
      variants: line.variants_all ?? null,
      reasons: line.reasons ?? null,
      generation: line.generation ?? null,
      links: token && linksByToken.has(token) ? linksByToken.get(token) : null,
      track_token: token,
      created_at: line.created_at ?? null,
      approved_at: line.approved_at ?? null,
    });
    mailCount += 1;
  }

  let eventCount = 0;
  for (const line of events) {
    if (!line) continue;
    insertEvent(workspace, {
      token: line.token ?? null,
      type: line.type ?? null,
      source: line.source ?? null,
      bot: line.bot === true,
      at: line.at ?? null,
      ua: line.ua ?? null,
      ip: line.ip ?? null,
      link_index: line.link_index ?? null,
      url: line.url ?? null,
    });
    eventCount += 1;
  }

  return { mails: mailCount, events: eventCount, imported: true };
}
