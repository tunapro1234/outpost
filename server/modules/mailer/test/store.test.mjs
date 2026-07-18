import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { closeWorkspaceDb } from "../../../lib/db.mjs";
import {
  syncEntities,
  insertMail,
  mailById,
  mailByToken,
  listMails,
  scheduleSend,
  dueSends,
  sendsByMail,
  markSend,
  insertEvent,
  eventsByToken,
  allEvents,
  insertFollowup,
  dueFollowups,
  markFollowup,
  importLegacy,
} from "../store.mjs";

function fakeWorkspace(directory, { entities = [], edges = [] } = {}) {
  return {
    directory,
    index: {
      entities: new Map(entities.map((e) => [e.id, e])),
      edges,
    },
  };
}

test("syncEntities mirrors entities and edges", async () => {
  const directory = await temporaryDirectory();
  const workspace = fakeWorkspace(directory, {
    entities: [
      { id: "p1", meta: { type: "person", name: "Ada", city: "Ankara", score: 0.9 } },
      { id: "c1", meta: { type: "company", name: "Acme", mails: ["a@acme.co", "b@acme.co"] } },
    ],
    edges: [{ source: "p1", target: "c1", label: "works_at", weight: 3 }],
  });
  const counts = syncEntities(workspace, { now: () => new Date("2026-07-18T00:00:00.000Z") });
  assert.deepEqual(counts, { entities: 2, edges: 1 });

  const db = workspace.__db;
  const p1 = db.prepare("SELECT * FROM entity WHERE id = ?").get("p1");
  assert.equal(p1.name, "Ada");
  assert.equal(p1.city, "Ankara");
  assert.equal(p1.score, 0.9);
  const c1 = db.prepare("SELECT * FROM entity WHERE id = ?").get("c1");
  assert.equal(c1.mail, "a@acme.co", "mail falls back to first of mails[]");
  const edge = db.prepare("SELECT * FROM edge WHERE source = ?").get("p1");
  assert.equal(edge.label, "works_at");
  assert.equal(JSON.parse(edge.meta_json).weight, 3);

  // Idempotent wipe+reinsert.
  const again = syncEntities(workspace);
  assert.deepEqual(again, { entities: 2, edges: 1 });
  const total = db.prepare("SELECT COUNT(*) AS n FROM entity").get().n;
  assert.equal(Number(total), 2);
  closeWorkspaceDb(workspace);
});

test("insertMail / mailById / mailByToken round-trip incl JSON columns", async () => {
  const directory = await temporaryDirectory();
  const workspace = fakeWorkspace(directory);
  insertMail(workspace, {
    id: "m1",
    person_id: "p1",
    company_id: "c1",
    to_addr: "ada@x.co",
    subject: "Hi",
    body: "Body",
    tone: "warm",
    variant: 2,
    score: 7.5,
    variants: [{ subject: "A" }, { subject: "B" }],
    reasons: ["r1", "r2"],
    generation: { model: "fable", ms: 12 },
    links: ["https://x.co/a"],
    track_token: "tok_abc",
    created_at: "2026-07-18T00:00:00.000Z",
    approved_at: "2026-07-18T01:00:00.000Z",
  });
  const byId = mailById(workspace, "m1");
  assert.equal(byId.subject, "Hi");
  assert.equal(byId.variant, 2);
  assert.deepEqual(byId.variants, [{ subject: "A" }, { subject: "B" }]);
  assert.deepEqual(byId.reasons, ["r1", "r2"]);
  assert.deepEqual(byId.generation, { model: "fable", ms: 12 });
  assert.deepEqual(byId.links, ["https://x.co/a"]);

  const byToken = mailByToken(workspace, "tok_abc");
  assert.equal(byToken.id, "m1");
  assert.equal(mailById(workspace, "nope"), null);
  assert.equal(mailByToken(workspace, "nope"), null);

  // INSERT OR REPLACE overwrites.
  insertMail(workspace, { id: "m1", subject: "Changed" });
  assert.equal(mailById(workspace, "m1").subject, "Changed");
  closeWorkspaceDb(workspace);
});

test("listMails newest approved_at first", async () => {
  const directory = await temporaryDirectory();
  const workspace = fakeWorkspace(directory);
  insertMail(workspace, { id: "a", approved_at: "2026-07-18T01:00:00.000Z" });
  insertMail(workspace, { id: "b", approved_at: "2026-07-18T03:00:00.000Z" });
  insertMail(workspace, { id: "c", approved_at: "2026-07-18T02:00:00.000Z" });
  const list = listMails(workspace);
  assert.deepEqual(list.map((m) => m.id), ["b", "c", "a"]);
  closeWorkspaceDb(workspace);
});

test("scheduleSend + dueSends time filtering, markSend, sendsByMail", async () => {
  const directory = await temporaryDirectory();
  const workspace = fakeWorkspace(directory);
  const early = scheduleSend(workspace, {
    mail_id: "m1",
    scheduled_at: "2026-07-18T00:00:00.000Z",
  });
  scheduleSend(workspace, {
    mail_id: "m1",
    scheduled_at: "2026-07-19T00:00:00.000Z",
  });
  const due = dueSends(workspace, "2026-07-18T12:00:00.000Z");
  assert.equal(due.length, 1);
  assert.equal(due[0].id, early);
  assert.equal(due[0].dispatch_mode, "dry_run");

  markSend(workspace, early, {
    status: "sent",
    message_id: "msg-1",
    rendered: { html: "<p>hi</p>" },
    attempts: 1,
  });
  const none = dueSends(workspace, "2026-07-18T12:00:00.000Z");
  assert.equal(none.length, 0, "sent send no longer due");
  const forMail = sendsByMail(workspace, "m1");
  assert.equal(forMail.length, 2);
  const sent = forMail.find((s) => s.id === early);
  assert.equal(sent.status, "sent");
  assert.equal(sent.message_id, "msg-1");
  assert.deepEqual(sent.rendered, { html: "<p>hi</p>" });
  closeWorkspaceDb(workspace);
});

test("insertEvent + eventsByToken + allEvents (bot boolean)", async () => {
  const directory = await temporaryDirectory();
  const workspace = fakeWorkspace(directory);
  insertEvent(workspace, { token: "t1", type: "open", source: "pixel", bot: false, at: "2026-07-18T00:00:00Z" });
  insertEvent(workspace, { token: "t1", type: "click", source: "link", bot: true, link_index: 0, url: "https://x.co" });
  insertEvent(workspace, { token: "t2", type: "open", bot: false });
  const t1 = eventsByToken(workspace, "t1");
  assert.equal(t1.length, 2);
  assert.equal(t1[0].bot, false);
  assert.equal(t1[1].bot, true);
  assert.equal(typeof t1[0].bot, "boolean");
  assert.equal(allEvents(workspace).length, 3);
  closeWorkspaceDb(workspace);
});

test("followups: insert, due filter, mark", async () => {
  const directory = await temporaryDirectory();
  const workspace = fakeWorkspace(directory);
  const id = insertFollowup(workspace, {
    mail_id: "m1",
    person_id: "p1",
    stage: 1,
    due_at: "2026-07-18T00:00:00.000Z",
  });
  insertFollowup(workspace, {
    mail_id: "m2",
    person_id: "p2",
    stage: 1,
    due_at: "2026-07-20T00:00:00.000Z",
  });
  assert.equal(dueFollowups(workspace, "2026-07-18T12:00:00.000Z").length, 1);
  markFollowup(workspace, id, { status: "done" });
  assert.equal(dueFollowups(workspace, "2026-07-18T12:00:00.000Z").length, 0);
  closeWorkspaceDb(workspace);
});

test("importLegacy backfills from seeded JSONL and is a no-op the second time", async () => {
  const directory = await temporaryDirectory();
  const mailsDir = path.join(directory, "mails");
  await fs.mkdir(mailsDir, { recursive: true });

  const outbox = [
    // Approved mail with matching tracking token.
    JSON.stringify({
      id: "o1",
      person_id: "p1",
      company_id: "c1",
      mail: "ada@x.co",
      subject: "Hello",
      body: "Body",
      variant_tone: "warm",
      variant: 1,
      queue_score: 5.5,
      variants_all: [{ s: "a" }],
      reasons: ["good"],
      generation: { model: "fable" },
      track_token: "tok1",
      approved: true,
      created_at: "2026-07-18T00:00:00.000Z",
      approved_at: "2026-07-18T01:00:00.000Z",
    }),
    // Not approved -> skipped.
    JSON.stringify({ id: "o2", approved: false, mail: "x@y.co" }),
    "{ malformed json",
  ].join("\n");
  const tracking = [
    JSON.stringify({ kind: "track", token: "tok1", links: ["https://x.co/a", "https://x.co/b"] }),
  ].join("\n");
  const events = [
    JSON.stringify({ token: "tok1", type: "open", source: "pixel", bot: false, at: "2026-07-18T02:00:00.000Z" }),
    JSON.stringify({ token: "tok1", type: "click", bot: true, link_index: 0, url: "https://x.co/a" }),
    "not json either",
  ].join("\n");

  await fs.writeFile(path.join(mailsDir, "outbox.jsonl"), outbox, "utf8");
  await fs.writeFile(path.join(mailsDir, "tracking.jsonl"), tracking, "utf8");
  await fs.writeFile(path.join(mailsDir, "events.jsonl"), events, "utf8");

  const workspace = fakeWorkspace(directory);
  const result = await importLegacy(workspace);
  assert.equal(result.imported, true);
  assert.equal(result.mails, 1);
  assert.equal(result.events, 2);

  const mail = mailById(workspace, "o1");
  assert.equal(mail.to_addr, "ada@x.co");
  assert.equal(mail.tone, "warm", "variant_tone maps to tone");
  assert.equal(mail.score, 5.5, "queue_score maps to score");
  assert.deepEqual(mail.variants, [{ s: "a" }], "variants_all maps to variants");
  assert.deepEqual(mail.links, ["https://x.co/a", "https://x.co/b"], "links pulled from tracking");
  assert.equal(eventsByToken(workspace, "tok1").length, 2);

  // JSONL files must remain untouched.
  assert.ok((await fs.stat(path.join(mailsDir, "outbox.jsonl"))).isFile());

  // Second run is a no-op.
  const again = await importLegacy(workspace);
  assert.deepEqual(again, { imported: false });
  assert.equal(listMails(workspace).length, 1);
  closeWorkspaceDb(workspace);
});
