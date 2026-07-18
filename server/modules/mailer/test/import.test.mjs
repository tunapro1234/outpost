import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { closeWorkspaceDb } from "../../../lib/db.mjs";
import { importMails } from "../import.mjs";
import { listMails, sendsByMail } from "../store.mjs";
import { buildMailRecords, mailAnalytics } from "../maildb.mjs";

async function seed(t) {
  const directory = await temporaryDirectory("outpost-import-");
  const person = { id: "p1", filePath: "p1.md", meta: { type: "person", name: "Ali Veli", mail: "ali@acme.com" } };
  const company = { id: "c1", filePath: "c1.md", meta: { type: "company", name: "Acme A.Ş." } };
  const workspace = {
    id: "probot", directory,
    mailIngestedPath: path.join(directory, "mails", "ingested.jsonl"),
    index: { entities: new Map([[person.id, person], [company.id, company]]), edges: [] },
  };
  t.after(() => { closeWorkspaceDb(workspace); return fs.rm(directory, { recursive: true, force: true }); });
  return workspace;
}

test("importMails: insan-yazımı mail → sent kayıt + kişi/şirket eşleşmesi", async (t) => {
  const workspace = await seed(t);
  const result = importMails(workspace, [
    { to: "ali@acme.com", subject: "Eski teklif", body: "Merhaba Ali", date: "2026-05-01T09:00:00Z", company: "Acme A.Ş." },
    { to: "yok@bilinmeyen.com", subject: "Yabancı", body: "x", date: "2026-05-02T09:00:00Z" },
  ]);
  assert.equal(result.imported, 2);
  assert.equal(result.matched_person, 1);
  assert.equal(result.matched_company, 1);

  const mails = listMails(workspace);
  assert.equal(mails.length, 2);
  const matched = mails.find((m) => m.person_id === "p1");
  assert.equal(matched.source, "imported");
  assert.equal(matched.authored_by, "human");
  assert.equal(matched.company_id, "c1");
  // Gönderilmiş olarak işaretli (sent).
  const [send] = sendsByMail(workspace, matched.id);
  assert.equal(send.status, "sent");
  assert.equal(send.dispatch_mode, "imported");
});

test("import idempotent: aynı mail iki kez → tek send", async (t) => {
  const workspace = await seed(t);
  const rec = [{ to: "ali@acme.com", subject: "A", body: "b", date: "2026-05-01T09:00:00Z", message_id: "<x@acme>" }];
  importMails(workspace, rec);
  importMails(workspace, rec);
  assert.equal(listMails(workspace).length, 1);
  assert.equal(sendsByMail(workspace, listMails(workspace)[0].id).length, 1);
});

test("maildb + analytics imported maili sent+insan olarak gösterir", async (t) => {
  const workspace = await seed(t);
  importMails(workspace, [{ to: "ali@acme.com", subject: "A", body: "b", date: "2026-05-01T09:00:00Z", company: "Acme A.Ş." }]);
  const [record] = await buildMailRecords(workspace, { now: () => new Date("2026-06-01T00:00:00Z") });
  assert.equal(record.source, "imported");
  assert.equal(record.sent, true);
  const analytics = await mailAnalytics(workspace, { now: () => new Date("2026-06-01T00:00:00Z") });
  assert.ok(analytics.by_source.some((c) => c.key === "insan (import)"));
});
