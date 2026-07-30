import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../../../test-support/helpers.mjs";
import { createRunRecord, writeRun } from "../../gather/journal.mjs";
import {
  insertMail,
  markSend,
  scheduleSend,
} from "../../mailer/store.mjs";

const NOW = () => new Date("2026-07-16T18:00:00.000Z");

async function metricsWorkspace(t) {
  const root = await temporaryDirectory("outpost-overview-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  const vault = path.join(directory, "vault");
  const warmVault = path.join(directory, "warm-vault");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "config.yaml"),
    `name: Fixture
networks:
  - id: research
    vault_path: vault
  - id: warm
    vault_path: warm-vault
    adapter: tr-network
    read_only: true
default_network: research
`,
    "utf8",
  );

  const entities = [
    ["people", "ulasildi", { type: "person", name: "Ulaşıldı", mail: "alice@example.com", score: 45 }],
    ["companies", "aday", { type: "company", name: "Aday", mail: "candidate@example.com", score: 25 }],
    ["schools", "esik", { type: "school", name: "Eşik", mail: "threshold@example.com", score: 15 }],
    ["institutions", "mailsiz", { type: "institution", name: "Mailsiz", score: 80 }],
    ["channels", "bos-mail", { type: "channel", name: "Boş Mail", mail: "-", score: 90 }],
  ];
  await Promise.all(entities.map(([kind, id, meta]) =>
    writeEntity(vault, kind, id, serializeMarkdown("", meta))));
  await fs.mkdir(warmVault, { recursive: true });
  await fs.writeFile(
    path.join(warmVault, "Hasan Bilgin.md"),
    "---\ntip: kisi\ndurum: konusuldu\n---\n\n# Hasan Bilgin\n",
    "utf8",
  );
  // Aynı entity_id iki network'te görünse de Overview birleşiminde tek kişidir.
  await fs.writeFile(
    path.join(warmVault, "Ulaşıldı.md"),
    "---\ntip: kisi\ndurum: yeni\n---\n\n# Ulaşıldı\n",
    "utf8",
  );

  const mails = [
    {
      id: "mail-old",
      entity_id: "ulasildi",
      person_id: "ulasildi",
      direction: "out",
      date: "2026-06-01",
      from: "sender@example.com",
      to: "other@example.com",
      summary: "Eski gönderim",
      source: "manual",
    },
    {
      id: "mail-recent",
      entity_id: "ulasildi",
      person_id: "ulasildi",
      direction: "out",
      date: "2026-07-14",
      from: "sender@example.com",
      to: "Alice@Example.com",
      summary: "İlk temas",
      source: "import",
    },
    {
      id: "mail-reply",
      entity_id: "ulasildi",
      person_id: "ulasildi",
      direction: "in",
      date: "2026-07-15",
      from: "alice@example.com",
      to: "sender@example.com",
      summary: "Yanıt",
      source: "import",
    },
    {
      id: "mail-today",
      entity_id: "ulasildi",
      person_id: "ulasildi",
      direction: "out",
      date: "2026-07-16T12:00:00.000Z",
      from: "sender@example.com",
      to: "alice@example.com",
      summary: "Takip",
      source: "manual",
    },
  ];
  await fs.mkdir(path.join(directory, "mails"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "mails", "log.jsonl"),
    `${mails.map((mail) => JSON.stringify(mail)).join("\n")}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(directory, "agents.yaml"),
    `- id: running-agent
  name: Running Agent
  zone: gathering
  model: gpt-test
  task: scrape-classify
  integration: browser
  schedule: manual
- id: idle-agent
  name: Idle Agent
  zone: network
  model: gpt-test
  task: dedup-review
  integration: local
  schedule: manual
`,
    "utf8",
  );

  const stageDirectory = path.join(directory, "stage");
  await fs.mkdir(stageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(stageDirectory, "proposal.md"),
    serializeMarkdown("Öneri", {
      type: "company",
      name: "Yeni Şirket",
      source_agent: "idle-agent",
      kind: "discover-company",
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(stageDirectory, "decisions.jsonl"),
    [
      JSON.stringify({ decision: "accept", kind: "discover-person" }),
      JSON.stringify({ decision: "accept", kind: "enrich" }),
      JSON.stringify({ decision: "reject", kind: "enrich" }),
      "",
    ].join("\n"),
    "utf8",
  );

  const run = createRunRecord("running-agent", { now: NOW });
  await writeRun({ directory }, run);
  return root;
}

test("metrics tüm network state'lerini entity_id ile birleştirip reached ve histogramı üretir", async (t) => {
  const root = await metricsWorkspace(t);
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    metricsNow: NOW,
  });
  t.after(() => app.close());

  const response = await app.inject({ url: "/api/ws/fixture/metrics" });
  assert.equal(response.statusCode, 200);
  const metrics = response.json();
  assert.deepEqual(metrics.totals, {
    entities: 5,
    byType: { person: 1, company: 1, institution: 1, school: 1, channel: 1 },
    withMail: 3,
    withoutMail: 2,
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(metrics.outreach).filter(([key]) => key !== "daily")),
    {
      mailsSent: 3,
      uniqueRecipients: 2,
      firstMailAt: "2026-06-01",
      lastMailAt: "2026-07-16T12:00:00.000Z",
      activeDays: 3,
      avgPerActiveDay: 1,
      byStatus: { sent: 3, replied: 1 },
      mailbox: { sent: 3, received: 1 },
      reached: 2,
      stateHistogram: { 0: 4, 1: 0, 2: 0, 3: 2, 4: 0, 5: 0 },
    },
  );
  assert.equal(metrics.outreach.daily.length, 30);
  assert.deepEqual(metrics.outreach.daily[0], { date: "2026-06-17", count: 0 });
  assert.deepEqual(metrics.outreach.daily.at(-1), { date: "2026-07-16", count: 1 });
  assert.deepEqual(
    metrics.outreach.daily.find((entry) => entry.date === "2026-07-14"),
    { date: "2026-07-14", count: 1 },
  );
  assert.equal(metrics.outreach.daily.reduce((sum, entry) => sum + entry.count, 0), 2);
  assert.deepEqual(metrics.gather, {
    staged: 1,
    acceptedTotal: 2,
    agents: 2,
    running: 1,
  });
  assert.deepEqual(metrics.reach, { candidates: 2 });
  assert.deepEqual(metrics.recentActivity, []);
});

test("metrics eksik kaynaklarda sıfır döner ve daily boş günleri tam 30 güne doldurur", async (t) => {
  const vault = await temporaryDirectory("outpost-overview-empty-");
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const app = await createApp({ vaultPath: vault, watch: false, metricsNow: NOW });
  t.after(() => app.close());

  const response = await app.inject({ url: "/api/ws/default/metrics" });
  assert.equal(response.statusCode, 200);
  const metrics = response.json();
  assert.deepEqual(metrics.totals, {
    entities: 0,
    byType: {},
    withMail: 0,
    withoutMail: 0,
  });
  assert.deepEqual(metrics.outreach, {
    mailsSent: 0,
    uniqueRecipients: 0,
    firstMailAt: null,
    lastMailAt: null,
    activeDays: 0,
    avgPerActiveDay: 0,
    daily: Array.from({ length: 30 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 5, 17 + index)).toISOString().slice(0, 10),
      count: 0,
    })),
    byStatus: { sent: 0, replied: 0 },
    mailbox: { sent: 0, received: 0 },
    reached: 0,
    stateHistogram: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  });
  assert.deepEqual(metrics.gather, {
    staged: 0,
    acceptedTotal: 0,
    agents: 0,
    running: 0,
  });
  assert.deepEqual(metrics.reach, { candidates: 0 });
  assert.deepEqual(metrics.recentActivity, []);
});

test("recentActivity yalnız gerçek zamanlı interaction, send, run ve manual status olaylarını döner", async (t) => {
  const root = await metricsWorkspace(t);
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    metricsNow: NOW,
  });
  t.after(() => app.close());
  const workspace = app.workspaceRegistry.get("fixture");

  await app.inject({
    method: "POST",
    url: "/api/ws/fixture/entity/aday/interactions",
    payload: {
      channel: "telefon",
      direction: "in",
      at: "2026-07-28T10:00:00.000Z",
    },
  });
  await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/entity/ulasildi/status",
    payload: { outreach_state: 4 },
  });
  insertMail(workspace, {
    id: "overview-sent",
    person_id: "ulasildi",
    to_addr: "alice@example.com",
    subject: "Gerçek gönderim",
  });
  const sendId = scheduleSend(workspace, {
    mail_id: "overview-sent",
    scheduled_at: "2026-07-27T09:00:00.000Z",
    status: "sent",
  });
  markSend(workspace, sendId, { sent_at: "2026-07-27T09:00:00.000Z" });
  const completed = createRunRecord("idle-agent", {
    now: () => new Date("2026-07-26T08:00:00.000Z"),
  });
  completed.status = "ok";
  completed.ended = "2026-07-26T08:05:00.000Z";
  await writeRun(workspace, completed);

  const metrics = (await app.inject({ url: "/api/ws/fixture/metrics" })).json();
  assert.deepEqual(
    new Set(metrics.recentActivity.map((item) => item.kind)),
    new Set(["interaction", "mail_send", "gather_run", "entity_status"]),
  );
  assert.ok(metrics.recentActivity.every((item) =>
    Number.isFinite(Date.parse(item.at)) &&
    typeof item.title === "string" &&
    item.title.length > 0));
  assert.deepEqual(
    [...metrics.recentActivity]
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at)),
    metrics.recentActivity,
  );
});
