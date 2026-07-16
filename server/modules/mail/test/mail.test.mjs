import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../app.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../../../test-support/helpers.mjs";
import {
  MailIngestor,
  readIngestedMailLog,
  scanMaildir,
} from "../service.mjs";

const FIXTURE_MAILDIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "maildir",
);
const NOW = () => new Date("2026-07-16T18:00:00.000Z");

async function fixtureWorkspace(t) {
  const root = await temporaryDirectory("outpost-mail-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  const vault = path.join(directory, "vault");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "config.yaml"), "name: Fixture\n", "utf8");
  await writeEntity(
    vault,
    "people",
    "alice",
    serializeMarkdown("", {
      type: "person",
      name: "Alice",
      mail: "alice@example.com",
      score: 40,
    }),
  );
  await writeEntity(
    vault,
    "companies",
    "carol-company",
    serializeMarkdown("", {
      type: "company",
      name: "Carol Company",
      mails: ["carol@example.org"],
      score: 35,
    }),
  );
  await fs.mkdir(path.join(directory, "mails"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "mails", "log.jsonl"),
    `${JSON.stringify({
      id: "manual-1",
      entity_id: "alice",
      person_id: "alice",
      direction: "out",
      date: "2026-07-15T10:00:00.000Z",
      from: "tuna@example.test",
      to: "alice@example.com",
      subject: "Önceki temas",
      summary: "Önceki temas",
      source: "manual",
    })}\n`,
    "utf8",
  );
  return { root, directory };
}

test("fixture Maildir başlıklarını parse eder, klasör yönünü belirler ve Message-ID dedup yapar", async () => {
  const warnings = [];
  const scanned = await scanMaildir(FIXTURE_MAILDIR, {
    onWarn: (error, context) => warnings.push({ error, context }),
  });

  assert.deepEqual(scanned.report, {
    mailDataPath: FIXTURE_MAILDIR,
    accounts: 2,
    scanned: 4,
    parsed: 3,
    unique: 2,
    duplicates: 1,
    failed: 1,
    unavailable: false,
  });
  assert.equal(warnings.length, 1);
  const sent = scanned.records.find((record) => record.direction === "sent");
  assert.deepEqual(sent, {
    id: "sent-1@example.test",
    account: "ada",
    direction: "sent",
    peer: ["alice@example.com", "bob@example.net"],
    subject: "Merhaba Dünya",
    date: "2026-07-16T09:30:00.000Z",
    folder: "Sent",
  });
  const received = scanned.records.find((record) => record.direction === "received");
  assert.match(received.id, /^[a-f0-9]{64}$/);
  assert.deepEqual(received.peer, ["carol@example.org"]);
  assert.equal(received.folder, "Inbox");
});

test("refresh endpoint ingested.jsonl dosyasına yalnızca yenileri append eder ve birleşik servisleri besler", async (t) => {
  const { root, directory } = await fixtureWorkspace(t);
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    mailSchedule: false,
    mailDataPath: FIXTURE_MAILDIR,
    metricsNow: NOW,
  });
  t.after(() => app.close());

  const first = await app.inject({ method: "POST", url: "/api/ws/fixture/mail/refresh" });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().added, 2);
  const second = await app.inject({ method: "POST", url: "/api/ws/fixture/mail/refresh" });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().added, 0);
  assert.equal(second.json().duplicates, 2);

  const ingestedPath = path.join(directory, "mails", "ingested.jsonl");
  const ingested = await readIngestedMailLog(ingestedPath);
  assert.equal(ingested.length, 2);
  assert.equal((await fs.readFile(ingestedPath, "utf8")).trim().split("\n").length, 2);

  const mails = (await app.inject({ url: "/api/ws/fixture/mails" })).json();
  assert.equal(mails.length, 3);
  assert.deepEqual(new Set(mails.map((mail) => mail.source)), new Set(["manual", "import"]));
  assert.equal(
    mails.find((mail) => mail.subject === "Merhaba Dünya").person_id,
    "alice",
  );
  assert.equal(
    mails.find((mail) => mail.direction === "in").entity_id,
    "carol-company",
  );

  const entities = (await app.inject({ url: "/api/ws/fixture/entities" })).json();
  assert.equal(entities.find((entity) => entity.id === "alice").mail_count, 2);
  assert.equal(entities.find((entity) => entity.id === "carol-company").mail_count, 1);
  const metrics = (await app.inject({ url: "/api/ws/fixture/metrics" })).json();
  assert.equal(metrics.outreach.mailsSent, 2);
  assert.equal(metrics.outreach.uniqueRecipients, 2);

  const reachStats = (await app.inject({ url: "/api/ws/fixture/reach/stats" })).json();
  assert.deepEqual(reachStats, {
    sent: 2,
    replied: 1,
    replyRate: 50,
    pendingFollowUp: 1,
  });
});

test("MailIngestor başlangıçta ve interval süresinde tarama yapar", async (t) => {
  const root = await temporaryDirectory("outpost-mail-interval-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = {
    id: "fixture",
    mailIngestedPath: path.join(root, "mails", "ingested.jsonl"),
  };
  const registry = { workspaces: new Map([[workspace.id, workspace]]) };
  let calls = 0;
  const ingestor = new MailIngestor(registry, {
    intervalMs: 10,
    scan: async () => {
      calls += 1;
      return {
        records: [],
        report: {
          accounts: 0,
          scanned: 0,
          parsed: 0,
          unique: 0,
          duplicates: 0,
          failed: 0,
          unavailable: false,
        },
      };
    },
  });
  t.after(() => ingestor.stop());
  await ingestor.start();
  await new Promise((resolve) => setTimeout(resolve, 45));
  await ingestor.stop();
  assert.ok(calls >= 2);
});

test("okunamayan Maildir boş rapor döndürür ve workspace'e dosya yazmaz", async (t) => {
  const root = await temporaryDirectory("outpost-mail-missing-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const warnings = [];
  const scanned = await scanMaildir(path.join(root, "missing"), {
    onWarn: (error, context) => warnings.push({ error, context }),
  });
  assert.equal(scanned.report.unavailable, true);
  assert.deepEqual(scanned.records, []);
  assert.equal(warnings.length, 1);
});

test("MailIngestor eksik Maildir için süreç boyunca yalnızca bir kez uyarır", async (t) => {
  const root = await temporaryDirectory("outpost-mail-warn-once-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = {
    id: "fixture",
    mailIngestedPath: path.join(root, "mails", "ingested.jsonl"),
  };
  const warnings = [];
  const ingestor = new MailIngestor(
    { workspaces: new Map([[workspace.id, workspace]]) },
    {
      mailDataPath: path.join(root, "missing"),
      onWarn: (error, context) => warnings.push({ error, context }),
    },
  );

  await ingestor.refreshAll();
  await ingestor.refreshAll();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].context, /^Maildir okunamadı:/);
});

test("MailIngestor başarılı taramadan sonra unavailable uyarı kilidini sıfırlar", async (t) => {
  const root = await temporaryDirectory("outpost-mail-warn-reset-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = {
    id: "fixture",
    mailIngestedPath: path.join(root, "mails", "ingested.jsonl"),
  };
  const warnings = [];
  let scanNumber = 0;
  const scan = async (_mailDataPath, { onWarn }) => {
    scanNumber += 1;
    const unavailable = scanNumber !== 2;
    if (unavailable) onWarn(new Error("missing"), "Maildir okunamadı: /missing");
    return {
      records: [],
      report: { unavailable },
    };
  };
  const ingestor = new MailIngestor(
    { workspaces: new Map([[workspace.id, workspace]]) },
    { scan, onWarn: (error, context) => warnings.push({ error, context }) },
  );

  await ingestor.refreshAll();
  await ingestor.refreshAll();
  await ingestor.refreshAll();
  assert.equal(warnings.length, 2);
});
