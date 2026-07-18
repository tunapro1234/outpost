import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { closeWorkspaceDb } from "../../../lib/db.mjs";
import { insertMail, insertEvent, scheduleSend, markSend } from "../store.mjs";
import { buildMailRecords, mailRecord, mailAnalytics } from "../maildb.mjs";

function personEntity(id, name, mail) {
  return { id, filePath: `${id}.md`, meta: { type: "person", name, mail } };
}

const TOKEN = "aaaabbbbccccdddd";
const NOW = () => new Date("2026-08-01T00:00:00.000Z");

async function seed(t, { entities = [], mails = [], events = [], sends = [], inbound = [] }) {
  const directory = await temporaryDirectory("outpost-maildb-");
  const workspace = {
    id: "probot", directory,
    mailIngestedPath: path.join(directory, "mails", "ingested.jsonl"),
    index: { entities: new Map(entities.map((e) => [e.id, e])) },
  };
  t.after(() => { closeWorkspaceDb(workspace); return fs.rm(directory, { recursive: true, force: true }); });
  if (inbound.length) {
    await fs.mkdir(path.join(directory, "mails"), { recursive: true });
    await fs.writeFile(workspace.mailIngestedPath, inbound.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  }
  for (const mail of mails) insertMail(workspace, mail);
  for (const event of events) insertEvent(workspace, event);
  for (const send of sends) {
    const id = scheduleSend(workspace, { mail_id: send.mail_id, scheduled_at: send.scheduled_at });
    if (send.mark) markSend(workspace, id, send.mark);
  }
  return workspace;
}

function baseMail(over = {}) {
  return {
    id: "outbox--m1", person_id: "p1", company_id: "c1", to_addr: "ali@x.com",
    subject: "FTC başarınız için tebrik", body: "gövde", tone: "samimi", variant: 1,
    score: 84, followup_stage: 0, author: "tuna", rationale: "hook",
    variants: [{ subject: "a" }, { subject: "b" }, { subject: "c" }], reasons: ["r"],
    generation: {
      model: "claude-sonnet-5", engine: "claude", generated_at: "2026-07-18T09:59:00Z",
      generation_ms: 15200, context_model: "gpt-5.6-luna", context_ms: 4100, attempts: 1,
      usage: { tokens_in: 1800, tokens_out: 320 }, skills: ["cold-intro.md"],
      prompt: "ÜÇ varyant üret ...", context: "person: ...",
    },
    links: ["https://probotstudio.com"], track_token: TOKEN,
    created_at: "2026-07-18T09:00:00Z", approved_at: "2026-07-18T10:00:00Z",
    ...over,
  };
}

test("buildMailRecords joins content, provenance, tracking and send", async (t) => {
  const workspace = await seed(t, {
    entities: [personEntity("p1", "Ali Veli", "ali@x.com")],
    mails: [baseMail()],
    sends: [{ mail_id: "outbox--m1", scheduled_at: "2026-07-21T06:33:00Z", mark: { status: "sent_dryrun", sent_at: "2026-07-21T06:33:00Z" } }],
    events: [
      { token: TOKEN, type: "open", bot: false, at: "2026-07-21T08:00:00Z" },
      { token: TOKEN, type: "click", link_index: 0, url: "https://probotstudio.com", at: "2026-07-21T08:01:00Z" },
    ],
  });
  const [r] = await buildMailRecords(workspace, { now: NOW });
  assert.equal(r.subject, "FTC başarınız için tebrik");
  assert.equal(r.person.name, "Ali Veli");
  assert.equal(r.generation.model, "claude-sonnet-5");
  assert.equal(r.send.status, "sent_dryrun");
  assert.equal(r.sent, true);
  assert.equal(r.tracking.status, "clicked");
  assert.equal(r.tracking.open_count, 1);
  assert.ok(Number.isFinite(r.durations.time_to_open_ms));
  assert.equal(r.body, undefined); // list view trims heavy fields
});

test("mailRecord returns full provenance (prompt/context/body/rendered)", async (t) => {
  const workspace = await seed(t, {
    entities: [personEntity("p1", "Ali Veli", "ali@x.com")],
    mails: [baseMail()],
  });
  const r = await mailRecord(workspace, "outbox--m1", { now: NOW });
  assert.equal(r.body, "gövde");
  assert.match(r.generation_full.prompt, /varyant/);
  assert.equal(await mailRecord(workspace, "yok"), null);
});

test("reply matching + replied_without_open flag", async (t) => {
  const workspace = await seed(t, {
    entities: [personEntity("p1", "Ali Veli", "ali@x.com")],
    mails: [baseMail()],
    inbound: [
      { id: "m0", account: "probotstudio", direction: "received", peer: ["ali@x.com"], subject: "eski", date: "2026-07-01T00:00:00Z", folder: "Inbox" },
      { id: "m1", account: "probotstudio", direction: "received", peer: ["ali@x.com"], subject: "Re: tebrik", date: "2026-07-19T08:00:00Z", folder: "Inbox" },
    ],
  });
  const [r] = await buildMailRecords(workspace, { now: NOW });
  assert.equal(r.reply.replied, true);
  assert.equal(r.reply.reply_subject, "Re: tebrik");
  // Açılma yok ama yanıt var → mail çalıştı, open ölçümü kaçırdı.
  assert.equal(r.flags.replied_without_open, true);
  assert.ok(r.durations.time_to_reply_ms > 0);
});

test("mailAnalytics breaks reply rate down by model, plus reliability counts", async (t) => {
  const workspace = await seed(t, {
    entities: [personEntity("p1", "Ali", "ali@x.com"), personEntity("p2", "Ayşe", "ayse@x.com")],
    mails: [
      baseMail({ id: "o1", person_id: "p1", track_token: "1111aaaa2222bbbb" }),
      baseMail({ id: "o2", person_id: "p2", tone: "kurumsal", track_token: "3333cccc4444dddd",
        generation: { model: "gpt-5.6-sol", engine: "codex" }, approved_at: "2026-07-18T11:00:00Z" }),
    ],
    inbound: [
      { id: "r1", account: "probotstudio", direction: "received", peer: ["ali@x.com"], subject: "Re", date: "2026-07-19T00:00:00Z", folder: "Inbox" },
    ],
  });
  const a = await mailAnalytics(workspace, { now: NOW });
  assert.equal(a.total, 2);
  assert.equal(a.overall.replied, 1);
  assert.equal(a.overall.reply_rate, 50);
  assert.equal(a.overall.replied_without_open, 1);
  assert.equal(a.overall.cold, 1); // p2: matured, no engagement
  const sonnet = a.by_model.find((c) => c.key === "claude-sonnet-5");
  assert.equal(sonnet.reply_rate, 100);
  assert.ok(a.by_tone.some((c) => c.key === "kurumsal"));
});
