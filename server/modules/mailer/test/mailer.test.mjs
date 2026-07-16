import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../app.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { inferAuthority, resolveCompany } from "../service.mjs";
import {
  createMailDraftStage,
  listMailDraftRecords,
  readOutbox,
} from "../drafts.mjs";
import { followUpDecision, runFollowUpEngine } from "../followup.mjs";
import { selectWriterCandidates } from "../writer.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_WORKSPACES = path.join(TEST_DIRECTORY, "fixtures/workspaces");

function variants(prefix = "İlk") {
  return [0, 1, 2].map((index) => ({
    subject: `${prefix} konu ${index + 1}`,
    body: `${prefix} gövde ve ayrışık hook ${index + 1}`,
    rationale: `${prefix} açı ${index + 1}`,
    tone: ["kurumsal", "teknik", "samimi"][index],
  }));
}

async function copiedApp(t) {
  const root = await temporaryDirectory("outpost-mailpipe-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(FIXTURE_WORKSPACES, "fixture"), path.join(root, "fixture"), {
    recursive: true,
  });
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    mailSchedule: false,
    followupSchedule: false,
  });
  t.after(() => app.close());
  return { app, workspace: app.workspaceRegistry.get("fixture"), root };
}

test("authority yoksa role/rol metninden belirtilen yetki seviyesini çıkarır", () => {
  assert.deepEqual(inferAuthority({ role: "Co-Founder & CEO" }), {
    authority: "founder", inferred: true,
  });
  assert.equal(inferAuthority({ rol: "Bölge Müdürü" }).authority, "exec");
  assert.equal(inferAuthority({ role: "Program Lead" }).authority, "manager");
  assert.equal(inferAuthority({ role: "Robotik Eğitmeni" }).authority, "staff");
  assert.equal(inferAuthority({}).authority, "unknown");
  assert.deepEqual(inferAuthority({ authority: "exec", role: "uzman" }), {
    authority: "exec", inferred: false,
  });
});

test("şirketi frontmatter yerine wikilink kenarından çözer ve en önemli komşuyu seçer", async (t) => {
  const root = await temporaryDirectory("outpost-mailer-company-edge-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(FIXTURE_WORKSPACES, "fixture"), path.join(root, "fixture"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "fixture/vault/people/kenar-adayi.md"),
    serializeMarkdown([
      "## İlişkiler",
      "- [[Skorlu Şirket]] — danışmanı",
      "- [[Acil Şirket]] — yöneticisi",
      "",
    ].join("\n"), {
      type: "person",
      name: "Kenar Adayı",
      company: "Öncelikli Şirket",
      mail: "kenar@example.com",
      scan_state: "partial",
      mail_state: "none",
    }),
    "utf8",
  );
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    mailSchedule: false,
  });
  t.after(() => app.close());
  const workspace = app.workspaceRegistry.get("fixture");
  const candidate = workspace.index.entities.get("kenar-adayi");

  assert.equal(resolveCompany(candidate, workspace.index)?.id, "acil");
  const result = (await app.inject({ url: "/api/ws/fixture/mailqueue" })).json();
  assert.deepEqual(
    result.awaitingScan.find(({ id }) => id === candidate.id),
    {
      id: "kenar-adayi",
      name: "Kenar Adayı",
      company_id: "acil",
      company_name: "Acil Şirket",
      companyImportance: 95,
    },
  );
});

test("GET mailqueue skor bileşenlerini açıklar, uygunluğu süzer ve awaitingScan'i sıralar", async (t) => {
  const app = await createApp({
    workspacesPath: FIXTURE_WORKSPACES,
    outpostVault: null,
    watch: false,
  });
  t.after(() => app.close());

  const response = await app.inject({ url: "/api/ws/fixture/mailqueue" });
  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.deepEqual(result.counts, { queue: 4, awaitingScan: 2 });
  assert.deepEqual(result.queue.map(({ id, score }) => ({ id, score })), [
    { id: "kurucu", score: 87.2 },
    { id: "kapali", score: 83 },
    { id: "direktor", score: 68 },
    { id: "okul-sinyali", score: 57.75 },
  ]);
  assert.deepEqual(result.queue[0], {
    id: "kurucu",
    name: "Kurucu Aday",
    company_id: "oncelikli",
    company_name: "Öncelikli Şirket",
    score: 87.2,
    reasons: [
      "Şirket önemi 80/100: Öncelikli Şirket importance değeri kullanıldı.",
      "Yetki 100/100: authority alanındaki founder seviyesi kullanıldı.",
      "Tarama derinliği 100/100: scan_state scanned, scan_depth 3 olarak değerlendirildi.",
      "Hook bonusu 68/100: 2 hook hesaba katıldı.",
    ],
    mail_state: "none",
    scan_state: "scanned",
  });
  assert.equal(result.queue[1].mail_state, "closed");
  assert.match(result.queue[2].reasons[0], /score değeri kullanıldı/);
  assert.match(result.queue[2].reasons[1], /Direktörü.*exec/u);
  assert.match(result.queue[3].reasons[0], /varsayılan 50/);
  assert.match(result.queue[3].reasons[3], /İTÜ okul sinyali/);
  assert.deepEqual(result.awaitingScan, [
    {
      id: "kismi",
      name: "Kısmi Taranan",
      company_id: "acil",
      company_name: "Acil Şirket",
      companyImportance: 95,
    },
    {
      id: "taranmamis",
      name: "Taranmamış Aday",
      company_id: "oncelikli",
      company_name: "Öncelikli Şirket",
      companyImportance: 80,
    },
  ]);
  assert.ok(!result.queue.some(({ id }) => ["mailsiz", "taslak"].includes(id)));
});

test("workspace signals.yaml repo şablonunu alan bazında override eder", async (t) => {
  const root = await temporaryDirectory("outpost-mailer-override-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(FIXTURE_WORKSPACES, "fixture"), path.join(root, "fixture"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "fixture", "signals.yaml"),
    "signal_weights:\n  hook: 50\n",
    "utf8",
  );
  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());

  const result = (await app.inject({ url: "/api/ws/fixture/mailqueue" })).json();
  assert.equal(result.queue.find(({ id }) => id === "kurucu").score, 92);
  assert.equal(result.queue.find(({ id }) => id === "direktor").score, 68);
});

test("writer cycle aynı şirketten yalnız bir kişi seçer ve pending şirketi tamamen dışlar", async (t) => {
  const root = await temporaryDirectory("outpost-writer-company-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(FIXTURE_WORKSPACES, "fixture"), path.join(root, "fixture"), { recursive: true });
  await fs.writeFile(
    path.join(root, "fixture/vault/people/kurucu-iki.md"),
    serializeMarkdown("## İlişkiler\n- [[Öncelikli Şirket]] — kurucusu\n", {
      type: "person",
      name: "İkinci Kurucu",
      mail: "ikinci@example.com",
      scan_state: "scanned",
      scan_depth: 3,
      authority: "founder",
      mail_state: "none",
    }),
    "utf8",
  );
  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false, mailSchedule: false });
  t.after(() => app.close());
  const workspace = app.workspaceRegistry.get("fixture");

  const first = await selectWriterCandidates(workspace, { limit: 5, now: new Date("2026-07-16T22:00:00Z") });
  const companyIds = first.selected.map((item) => item.company_id).filter(Boolean);
  assert.equal(new Set(companyIds).size, companyIds.length);
  assert.equal(first.selected.filter((item) => item.company_id === "oncelikli").length, 1);

  const person = workspace.index.entities.get("kurucu");
  const company = workspace.index.entities.get("oncelikli");
  await createMailDraftStage(workspace, {
    person, company, variants: variants(), score: 80, reasons: [],
    now: () => new Date("2026-07-16T22:01:00Z"),
  });
  const blocked = await selectWriterCandidates(workspace, { limit: 5, now: new Date("2026-07-16T22:02:00Z") });
  assert.ok(!blocked.selected.some((item) => item.company_id === "oncelikli"));
});

test("maildraft API approve outbox-ready kaydı yazar; reject taslağı kapatıp state'i none yapar", async (t) => {
  const { app, workspace } = await copiedApp(t);
  const person = workspace.index.entities.get("kurucu");
  const company = workspace.index.entities.get("oncelikli");
  const approvedDraft = await createMailDraftStage(workspace, {
    person, company, variants: variants(), score: 87.2, reasons: ["yüksek skor"],
    now: () => new Date("2026-07-16T21:00:00Z"),
  });
  const listed = (await app.inject({ url: "/api/ws/fixture/maildrafts" })).json();
  assert.equal(listed.drafts.length, 1);
  assert.deepEqual(listed.drafts[0].person, { id: "kurucu", name: "Kurucu Aday" });
  assert.equal(listed.drafts[0].followup_stage, 0);

  const approved = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${approvedDraft.id}/approve`,
    payload: { variant: 1, subject: "Düzenlenmiş konu", body: "Düzenlenmiş gövde" },
  });
  assert.equal(approved.statusCode, 200);
  const outbox = await readOutbox(workspace);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].approved, true);
  assert.equal(outbox[0].sent, false);
  assert.equal(outbox[0].subject, "Düzenlenmiş konu");
  assert.equal(workspace.index.entities.get("kurucu").meta.mail_state, "approved");
  assert.equal((await listMailDraftRecords(workspace)).length, 0);

  const rejectedPerson = workspace.index.entities.get("direktor");
  const rejectedCompany = workspace.index.entities.get("skorlu");
  const rejectedDraft = await createMailDraftStage(workspace, {
    person: rejectedPerson,
    company: rejectedCompany,
    variants: variants("İkinci"),
    score: 68,
    reasons: [],
    now: () => new Date("2026-07-16T21:01:00Z"),
  });
  const rejected = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${rejectedDraft.id}/reject`,
    payload: { reason: "uygun değil" },
  });
  assert.equal(rejected.statusCode, 200);
  assert.equal(workspace.index.entities.get("direktor").meta.mail_state, "none");
  assert.equal((await readOutbox(workspace)).length, 1);
  assert.equal((await listMailDraftRecords(workspace)).length, 0);
});

test("follow-up motoru 4/5 günlük eşikleri uygular, iki takipten sonra kapatır ve boş trafikte no-op olur", async (t) => {
  const now = new Date("2026-07-16T12:00:00Z");
  const person = (mailsSent) => ({ meta: { mails_sent: mailsSent } });
  assert.equal(followUpDecision({
    person: person(1), outbound: { date: "2026-07-12T12:00:01Z" }, now,
  }).action, "none");
  assert.deepEqual(followUpDecision({
    person: person(1), outbound: { date: "2026-07-12T12:00:00Z" }, now,
  }).stage, 1);
  assert.equal(followUpDecision({
    person: person(2), outbound: { date: "2026-07-11T12:00:01Z" }, now,
  }).action, "none");
  assert.deepEqual(followUpDecision({
    person: person(2), outbound: { date: "2026-07-11T12:00:00Z" }, now,
  }).stage, 2);
  assert.equal(followUpDecision({
    person: person(3), outbound: { date: "2026-07-11T12:00:00Z", followup_stage: 2 }, now,
  }).action, "close");

  const { workspace } = await copiedApp(t);
  const followupVariants = variants("Re:").map((variant, index) => ({
    ...variant,
    subject: `Re: kısa hatırlatma ${index + 1}`,
  }));
  const generated = await runFollowUpEngine(workspace, {
    now: () => now,
    mails: [{
      id: "sent-1",
      entity_id: "kurucu",
      person_id: "kurucu",
      direction: "out",
      date: "2026-07-12T12:00:00Z",
      subject: "Robotik iş birliği",
    }],
    generateVariants: async () => followupVariants,
  });
  assert.equal(generated.drafted, 1);
  assert.equal(generated.drafts[0].followup_stage, 1);
  assert.equal(workspace.index.entities.get("kurucu").meta.mail_state, "followup_1");

  const empty = await runFollowUpEngine(workspace, {
    now: () => now,
    mails: [],
    generateVariants: async () => assert.fail("boş trafikte üretici çağrılmamalı"),
  });
  assert.deepEqual({ checked: empty.checked, drafted: empty.drafted, closed: empty.closed }, {
    checked: 0, drafted: 0, closed: 0,
  });
});
