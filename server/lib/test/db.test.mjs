import test from "node:test";
import assert from "node:assert/strict";
import { temporaryDirectory } from "../../test-support/helpers.mjs";
import { openWorkspaceDb, closeWorkspaceDb } from "../db.mjs";

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name);
}

test("migrations create all tables and set user_version", async () => {
  const directory = await temporaryDirectory();
  const workspace = { directory };
  const db = openWorkspaceDb(workspace);
  const names = tableNames(db);
  for (const expected of [
    "entity",
    "edge",
    "mail",
    "mail_send",
    "mail_event",
    "followup",
    "interaction",
    "entity_status",
    "temas_durumu",
  ]) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
  const version = db.prepare("PRAGMA user_version").get().user_version;
  assert.equal(Number(version), 4);
  // Migration 1: mail.source + mail.authored_by kolonları eklendi.
  const mailCols = db.prepare("PRAGMA table_info(mail)").all().map((c) => c.name);
  assert.ok(mailCols.includes("source"));
  assert.ok(mailCols.includes("authored_by"));
  assert.throws(
    () => db.prepare(
      `INSERT INTO entity_status
       (workspace, network, entity_id, outreach_state)
       VALUES ('fixture', 'default', 'ada', 7)`,
    ).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(
      `INSERT INTO temas_durumu
       (ws, network, entity_id, durum, guncelleme_ts, kaynak)
       VALUES ('fixture', 'hedef', 'ada', 'otomatik', '2026-08-01', 'agent')`,
    ).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(
      `INSERT INTO interaction
       (workspace, network, entity_id, channel, direction, at)
       VALUES ('fixture', 'default', 'ada', 'telegram', 'out', '2026-07-30')`,
    ).run(),
    /CHECK constraint failed/,
  );
  closeWorkspaceDb(workspace);
});

test("openWorkspaceDb caches handle on workspace.__db", async () => {
  const directory = await temporaryDirectory();
  const workspace = { directory };
  const first = openWorkspaceDb(workspace);
  const second = openWorkspaceDb(workspace);
  assert.equal(first, second);
  assert.equal(workspace.__db, first);
  closeWorkspaceDb(workspace);
  assert.equal(workspace.__db, null);
});

test("migrations are idempotent on reopen", async () => {
  const directory = await temporaryDirectory();
  const workspace = { directory };
  const db1 = openWorkspaceDb(workspace);
  db1
    .prepare("INSERT INTO entity (id, type, name) VALUES (?, ?, ?)")
    .run("e1", "person", "Ada");
  closeWorkspaceDb(workspace);

  // Reopen: should not error, should preserve data, version stays at migration count.
  const db2 = openWorkspaceDb(workspace);
  const version = db2.prepare("PRAGMA user_version").get().user_version;
  assert.equal(Number(version), 4);
  const row = db2.prepare("SELECT name FROM entity WHERE id = ?").get("e1");
  assert.equal(row.name, "Ada");
  closeWorkspaceDb(workspace);
});
