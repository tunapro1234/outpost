import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { insertMail, scheduleSend, sendsByMail } from "../store.mjs";
import { dispatchDueSends } from "../dispatch.mjs";
import { closeWorkspaceDb } from "../../../lib/db.mjs";

const TOKEN = "aaaabbbbccccdddd";

async function seed(t) {
  const directory = await temporaryDirectory("outpost-dispatch-");
  const workspace = { id: "probot", directory, index: { entities: new Map() } };
  t.after(() => { closeWorkspaceDb(workspace); return fs.rm(directory, { recursive: true, force: true }); });
  insertMail(workspace, {
    id: "outbox--m1", person_id: "p1", to_addr: "ali@x.com",
    subject: "Merhaba", body: "Selam, https://probotstudio.com/x sağol",
    track_token: TOKEN, links: ["https://probotstudio.com/x"],
    approved_at: "2026-07-20T09:00:00.000Z",
  });
  return workspace;
}

test("dry-run dispatch renders and marks sent_dryrun, sends nothing", async (t) => {
  const workspace = await seed(t);
  scheduleSend(workspace, { mail_id: "outbox--m1", scheduled_at: "2026-07-20T09:30:00.000Z" });

  let relayCalled = false;
  const summary = await dispatchDueSends(workspace, {
    now: () => new Date("2026-07-20T10:00:00.000Z"),
    relay: () => { relayCalled = true; return { message_id: "x" }; },
    // dispatchMode defaults to dry_run → relay must NOT be called.
  });
  assert.equal(summary.processed, 1);
  assert.equal(summary.dry_run, 1);
  assert.equal(summary.sent, 0);
  assert.equal(relayCalled, false, "dry-run must not call the relay");

  const [send] = sendsByMail(workspace, "outbox--m1");
  assert.equal(send.status, "sent_dryrun");
  assert.match(send.message_id, /aaaabbbbccccdddd/);
  assert.match(send.rendered.html, /t\/o\/probot\/aaaabbbbccccdddd\.gif/);
});

test("future-scheduled sends are not dispatched yet", async (t) => {
  const workspace = await seed(t);
  scheduleSend(workspace, { mail_id: "outbox--m1", scheduled_at: "2026-07-25T09:30:00.000Z" });
  const summary = await dispatchDueSends(workspace, {
    now: () => new Date("2026-07-20T10:00:00.000Z"),
  });
  assert.equal(summary.processed, 0);
});

test("brevo mode with a relay actually calls it and marks sent", async (t) => {
  const workspace = await seed(t);
  // Canlı gönderim için send KALICI olarak brevo schedule edilmeli (dry_run değil).
  scheduleSend(workspace, { mail_id: "outbox--m1", scheduled_at: "2026-07-20T09:30:00.000Z", dispatch_mode: "brevo" });
  const summary = await dispatchDueSends(workspace, {
    now: () => new Date("2026-07-20T10:00:00.000Z"),
    dispatchMode: "brevo",
    relay: async (rendered) => ({ message_id: `relay-${rendered.to}` }),
  });
  assert.equal(summary.sent, 1);
  const [send] = sendsByMail(workspace, "outbox--m1");
  assert.equal(send.status, "sent");
  assert.equal(send.message_id, "relay-ali@x.com");
});

test("guvenlik: dry_run schedule edilmis send, runtime brevo olsa bile canli gitmez", async (t) => {
  const workspace = await seed(t);
  scheduleSend(workspace, { mail_id: "outbox--m1", scheduled_at: "2026-07-20T09:30:00.000Z", dispatch_mode: "dry_run" });
  let relayCalled = false;
  const summary = await dispatchDueSends(workspace, {
    now: () => new Date("2026-07-20T10:00:00.000Z"),
    dispatchMode: "brevo",
    relay: async () => { relayCalled = true; return { message_id: "x" }; },
  });
  assert.equal(relayCalled, false, "kalici dry_run send asla relay cagirmamali");
  assert.equal(summary.dry_run, 1);
  assert.equal(summary.sent, 0);
});

test("reply-cancel: mail olusturulduktan sonra cevap gelirse scheduled send iptal edilir", async (t) => {
  const directory = await temporaryDirectory("outpost-cancel-");
  const workspace = {
    id: "probot", directory,
    mailIngestedPath: `${directory}/mails/ingested.jsonl`,
    index: { entities: new Map([["p1", { id: "p1", filePath: "p1.md", meta: { type: "person", name: "Ali", mail: "ali@x.com" } }]]) },
  };
  t.after(() => { closeWorkspaceDb(workspace); return fs.rm(directory, { recursive: true, force: true }); });
  await fs.mkdir(`${directory}/mails`, { recursive: true });
  // Kişi, mail olusturulduktan (10:00) SONRA (12:00) cevap yazmis.
  await fs.writeFile(workspace.mailIngestedPath, JSON.stringify({
    id: "r1", account: "probotstudio", direction: "received", peer: ["ali@x.com"],
    subject: "Re", date: "2026-07-20T12:00:00Z", folder: "Inbox",
  }) + "\n", "utf8");
  insertMail(workspace, { id: "outbox--f1", person_id: "p1", to_addr: "ali@x.com", subject: "Follow-up", body: "x", track_token: "aaaabbbbccccdddd", created_at: "2026-07-20T10:00:00Z", approved_at: "2026-07-20T10:00:00Z" });
  scheduleSend(workspace, { mail_id: "outbox--f1", scheduled_at: "2026-07-23T09:32:00Z" });

  const summary = await dispatchDueSends(workspace, { now: () => new Date("2026-07-23T10:00:00Z") });
  assert.equal(summary.canceled, 1);
  assert.equal(summary.dry_run, 0);
  const [send] = sendsByMail(workspace, "outbox--f1");
  assert.equal(send.status, "canceled");
  assert.equal(send.error, "reply-received");
});
