// SQLite data layer for Outpost. Uses Node's built-in node:sqlite (DatabaseSync),
// available without any flag on Node 22.22 (only a harmless ExperimentalWarning).
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Ordered migrations. Each entry is applied when its index >= current user_version.
// After applying, user_version is bumped to migrations.length.
const MIGRATIONS = [
  // Migration 0: initial schema.
  `
CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY, type TEXT, name TEXT, city TEXT, subtype TEXT,
  mail TEXT, score REAL, meta_json TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_entity_type ON entity(type);
CREATE TABLE IF NOT EXISTS edge (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, label TEXT, meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_edge_source ON edge(source);
CREATE INDEX IF NOT EXISTS idx_edge_target ON edge(target);
CREATE TABLE IF NOT EXISTS mail (
  id TEXT PRIMARY KEY, draft_id TEXT, person_id TEXT, company_id TEXT,
  to_addr TEXT, subject TEXT, body TEXT, tone TEXT, variant INTEGER, score REAL,
  followup_stage INTEGER DEFAULT 0, author TEXT, rationale TEXT,
  variants_json TEXT, reasons_json TEXT, generation_json TEXT, links_json TEXT,
  track_token TEXT, created_at TEXT, approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_person ON mail(person_id);
CREATE INDEX IF NOT EXISTS idx_mail_token ON mail(track_token);
CREATE TABLE IF NOT EXISTS mail_send (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mail_id TEXT, scheduled_at TEXT,
  window_reason TEXT, dispatch_mode TEXT, status TEXT, rendered_json TEXT,
  message_id TEXT, sent_at TEXT, error TEXT, attempts INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_send_status ON mail_send(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_send_mail ON mail_send(mail_id);
CREATE TABLE IF NOT EXISTS mail_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT, type TEXT, source TEXT,
  bot INTEGER DEFAULT 0, at TEXT, ua TEXT, ip TEXT, link_index INTEGER, url TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_token ON mail_event(token, type);
CREATE TABLE IF NOT EXISTS followup (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mail_id TEXT, person_id TEXT,
  stage INTEGER, due_at TEXT, status TEXT
);
CREATE INDEX IF NOT EXISTS idx_followup_due ON followup(status, due_at);
`,
  // Migration 1: mailin kaynağı ve yazarı. Dışarıdan içeri alınan (compec korpusu
  // gibi) insan-yazımı mailleri AI-üretimlerinden ayırmak için. source: generated
  // | imported; authored_by: model id | "human" | kişi adı.
  `
ALTER TABLE mail ADD COLUMN source TEXT;
ALTER TABLE mail ADD COLUMN authored_by TEXT;
CREATE INDEX IF NOT EXISTS idx_mail_source ON mail(source);
`,
  // Migration 2: channel-independent contact history and per-network entity
  // state. The CHECK constraints are deliberate: API validation is helpful,
  // but every writer (including local scripts) must obey the same invariants.
  `
CREATE TABLE IF NOT EXISTS interaction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace TEXT NOT NULL,
  network TEXT,
  entity_id TEXT NOT NULL,
  channel TEXT NOT NULL
    CHECK(channel IN ('whatsapp', 'mail', 'telefon', 'yuzyuze', 'diger')),
  direction TEXT NOT NULL DEFAULT 'out'
    CHECK(direction IN ('out', 'in')),
  at TEXT NOT NULL,
  note TEXT,
  source TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_interaction_workspace_entity
  ON interaction(workspace, entity_id);

CREATE TABLE IF NOT EXISTS entity_status (
  workspace TEXT,
  network TEXT,
  entity_id TEXT,
  outreach_state INTEGER
    CHECK(outreach_state BETWEEN 0 AND 5),
  state_source TEXT
    CHECK(state_source IN ('manual', 'derived')),
  research_status TEXT NOT NULL DEFAULT 'none'
    CHECK(research_status IN ('none', 'active', 'done')),
  research_agent TEXT,
  updated_at TEXT,
  PRIMARY KEY (workspace, network, entity_id)
);
`,
];

function currentUserVersion(db) {
  const row = db.prepare("PRAGMA user_version").get();
  return Number(row?.user_version ?? 0);
}

function applyMigrations(db) {
  const version = currentUserVersion(db);
  for (let index = version; index < MIGRATIONS.length; index += 1) {
    db.exec(MIGRATIONS[index]);
  }
  if (version < MIGRATIONS.length) {
    // PRAGMA user_version does not accept bound parameters.
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  }
}

export function openWorkspaceDb(workspace) {
  if (workspace.__db) return workspace.__db;
  const dbPath = path.join(workspace.directory, "outpost.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  // İkinci bir proses (CLI, yedekleme) dosyaya dokunursa SQLITE_BUSY yerine bekle.
  db.exec("PRAGMA busy_timeout=5000;");
  applyMigrations(db);
  workspace.__db = db;
  return db;
}

export function closeWorkspaceDb(workspace) {
  if (!workspace.__db) return;
  try {
    workspace.__db.close();
  } finally {
    workspace.__db = null;
  }
}
