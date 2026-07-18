import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { buildMailRecords, mailRecord, mailAnalytics } from "../maildb.mjs";

function personEntity(id, name, mail) {
  return { id, filePath: `${id}.md`, meta: { type: "person", name, mail } };
}

async function seedWorkspace(t, { outbox, tracking = [], events = [], inbound = [], entities = [] }) {
  const directory = await temporaryDirectory("outpost-maildb-");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "mails"), { recursive: true });
  const write = async (rel, rows) =>
    fs.writeFile(path.join(directory, rel), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  await write(path.join("mails", "outbox.jsonl"), outbox);
  if (tracking.length) await write(path.join("mails", "tracking.jsonl"), tracking);
  if (events.length) await write(path.join("mails", "events.jsonl"), events);
  if (inbound.length) await write(path.join("mails", "ingested.jsonl"), inbound);
  return {
    directory,
    mailsOutboxPath: path.join(directory, "mails", "outbox.jsonl"),
    mailIngestedPath: path.join(directory, "mails", "ingested.jsonl"),
    index: { entities: new Map(entities.map((e) => [e.id, e])) },
  };
}

const TOKEN = "aaaabbbbccccdddd";

function approvedOutbox(overrides = {}) {
  return {
    id: "outbox--mail-draft--p1--f0",
    draft_id: "mail-draft--p1--f0",
    person_id: "p1",
    company_id: "c1",
    subject: "FTC başarınız için tebrik",
    body: "gövde",
    variant: 1,
    variant_tone: "samimi",
    variants_all: [{ subject: "a" }, { subject: "b" }, { subject: "c" }],
    queue_score: 84,
    author: "tuna",
    followup_stage: 0,
    created_at: "2026-07-18T09:00:00.000Z",
    approved_at: "2026-07-18T10:00:00.000Z",
    approved: true,
    sent: false,
    track_token: TOKEN,
    generation: {
      model: "claude-sonnet-5",
      engine: "claude",
      generated_at: "2026-07-18T09:59:00.000Z",
      generation_ms: 15200,
      context_model: "gpt-5.6-luna",
      context_ms: 4100,
      attempts: 1,
      usage: { tokens_in: 1800, tokens_out: 320 },
      skills: ["cold-intro.md", "variants.md"],
      prompt: "ÜÇ outreach mail varyantı üret ...",
      context: "person: ...",
    },
    ...overrides,
  };
}

test("buildMailRecords joins content, provenance and tracking", async (t) => {
  const workspace = await seedWorkspace(t, {
    entities: [personEntity("p1", "Ali Veli", "ali@x.com")],
    outbox: [approvedOutbox()],
    tracking: [{ kind: "track", token: TOKEN, person_id: "p1", mail: "ali@x.com", links: ["https://probotstudio.com"] }],
    events: [
      { token: TOKEN, type: "open", bot: false, at: "2026-07-18T10:30:00.000Z" },
      { token: TOKEN, type: "click", link_index: 0, url: "https://probotstudio.com", at: "2026-07-18T10:31:00.000Z" },
    ],
  });
  const [record] = await buildMailRecords(workspace);
  assert.equal(record.subject, "FTC başarınız için tebrik");
  assert.equal(record.person.name, "Ali Veli");
  assert.equal(record.tone, "samimi");
  assert.equal(record.generation.model, "claude-sonnet-5");
  assert.equal(record.generation.generation_ms, 15200);
  assert.equal(record.tracking.status, "clicked");
  assert.equal(record.tracking.open_count, 1);
  assert.equal(record.tracking.click_count, 1);
  // Liste görünümü büyük alanları taşımaz.
  assert.equal(record.body, undefined);
  assert.equal(record.generation.prompt, undefined);
});

test("mailRecord returns the full provenance (prompt/context/body)", async (t) => {
  const workspace = await seedWorkspace(t, {
    entities: [personEntity("p1", "Ali Veli", "ali@x.com")],
    outbox: [approvedOutbox()],
  });
  const record = await mailRecord(workspace, "outbox--mail-draft--p1--f0");
  assert.equal(record.body, "gövde");
  assert.match(record.generation_full.prompt, /varyant/);
  assert.equal(record.generation_full.context, "person: ...");
  assert.equal((await mailRecord(workspace, "yok")), null);
});

test("reply matching: inbound after send counts as a reply", async (t) => {
  const workspace = await seedWorkspace(t, {
    entities: [personEntity("p1", "Ali Veli", "ali@x.com")],
    outbox: [approvedOutbox()],
    inbound: [
      // Gönderimden ÖNCE gelen mail reply sayılmaz.
      { id: "m0", account: "probotstudio", direction: "received", peer: ["ali@x.com"], subject: "eski", date: "2026-07-01T00:00:00.000Z", folder: "Inbox" },
      // Gönderimden SONRA gelen = reply.
      { id: "m1", account: "probotstudio", direction: "received", peer: ["ali@x.com"], subject: "Re: tebrik", date: "2026-07-19T08:00:00.000Z", folder: "Inbox" },
    ],
  });
  const [record] = await buildMailRecords(workspace);
  assert.equal(record.reply.replied, true);
  assert.equal(record.reply.reply_subject, "Re: tebrik");
  assert.ok(record.reply.time_to_reply_ms > 0);
});

test("mailAnalytics breaks reply rate down by model and tone", async (t) => {
  const workspace = await seedWorkspace(t, {
    entities: [
      personEntity("p1", "Ali", "ali@x.com"),
      personEntity("p2", "Ayşe", "ayse@x.com"),
    ],
    outbox: [
      approvedOutbox({ id: "o1", person_id: "p1" }),
      approvedOutbox({
        id: "o2", person_id: "p2", variant_tone: "kurumsal",
        generation: { model: "gpt-5.6-sol", engine: "codex" },
        approved_at: "2026-07-18T11:00:00.000Z",
      }),
    ],
    inbound: [
      { id: "r1", account: "probotstudio", direction: "received", peer: ["ali@x.com"], subject: "Re", date: "2026-07-19T00:00:00.000Z", folder: "Inbox" },
    ],
  });
  const analytics = await mailAnalytics(workspace);
  assert.equal(analytics.total, 2);
  assert.equal(analytics.overall.n, 2);
  assert.equal(analytics.overall.replied, 1);
  assert.equal(analytics.overall.reply_rate, 50);
  const sonnet = analytics.by_model.find((cell) => cell.key === "claude-sonnet-5");
  assert.equal(sonnet.n, 1);
  assert.equal(sonnet.reply_rate, 100);
  assert.ok(analytics.by_tone.some((cell) => cell.key === "kurumsal"));
  assert.ok(analytics.by_score.some((cell) => cell.key === "80-89"));
});
