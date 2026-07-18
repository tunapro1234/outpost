import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../app.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import {
  classifyEdgeLabel,
  companyFit,
  inferAuthority,
  loadSignals,
  mailQueue,
  resolveCompany,
} from "../service.mjs";
import {
  createMailDraftStage,
  listMailDraftRecords,
  readOutbox,
} from "../drafts.mjs";
import { followUpDecision, runFollowUpEngine } from "../followup.mjs";
import { runMailWriterCycle, selectWriterCandidates } from "../writer.mjs";
import { dispatchDueSends } from "../dispatch.mjs";
import { buildMailRecords, mailAnalytics } from "../maildb.mjs";

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

async function copiedApp(t, options = {}) {
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
    defaultUser: "tuna",
    ...options,
  });
  t.after(() => app.close());
  return { app, workspace: app.workspaceRegistry.get("fixture"), root };
}

async function readFeedback(workspace) {
  try {
    const source = await fs.readFile(path.join(workspace.directory, "mails/feedback.jsonl"), "utf8");
    return source.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

test("kenar etiketini employer, alumni ve zayıf context olarak sınıflandırır", () => {
  for (const label of [
    "kurucu temsilcisi", "müdür yardımcısı", "sınıf öğretmeni", "mentor bağı",
  ]) assert.equal(classifyEdgeLabel(label), "EMPLOYER", label);
  assert.equal(classifyEdgeLabel("mezunu; mezuniyet yılı 2012"), "ALUMNI");
  for (const label of ["yarıştığı program", "first takım kaydı", "sponsor bağı", "iletişim kanalı"]) {
    assert.equal(classifyEdgeLabel(label), "CONTEXT", label);
  }
  assert.equal(classifyEdgeLabel(null), "UNLABELED");
});

test("doğrulanmamış founder/exec rolünü manager seviyesinde tavana alır, employer kenarını doğrular", () => {
  const capped = inferAuthority({ role: "Co-Founder & CEO" });
  assert.equal(capped.authority, "manager");
  assert.equal(capped.verified, false);
  assert.equal(capped.uncappedAuthority, "founder");
  assert.equal(inferAuthority({ rol: "Bölge Müdürü" }).authority, "manager");
  assert.equal(inferAuthority({ role: "Program Lead" }).authority, "manager");
  assert.equal(inferAuthority({ role: "Robotik Eğitmeni" }).authority, "staff");
  assert.equal(inferAuthority({}).authority, "unknown");
  const edgeVerified = inferAuthority({ role: "uzman" }, "müdür yardımcısı");
  assert.equal(edgeVerified.authority, "exec");
  assert.equal(edgeVerified.verified, true);
  assert.equal(edgeVerified.evidence, "müdür yardımcısı");
  const metaVerified = inferAuthority({ authority: "exec", role: "uzman" });
  assert.equal(metaVerified.authority, "exec");
  assert.equal(metaVerified.verified, true);
});

test("alumni/context kenarlarını employer saymaz; fit subtype'ı tipe tercih eder ve uygunsuzları referral'a koyar", async () => {
  const alumni = { id: "mezun", meta: {
    type: "person", name: "Mezun Aday", mail: "mezun@example.com",
    scan_state: "scanned", mail_state: "none", role: "kurucu",
  } };
  const mentor = { id: "mentor", meta: {
    type: "person", name: "Takım Mentoru", mail: "mentor@example.com",
    scan_state: "scanned", mail_state: "none",
  } };
  const college = { id: "kolej", meta: { type: "school", name: "Örnek Kolej", subtype: "kolej" } };
  const team = { id: "takim", meta: { type: "school", name: "Örnek Takım", subtype: "takim" } };
  const index = {
    entities: new Map([alumni, mentor, college, team].map((entity) => [entity.id, entity])),
    edges: [
      { source: alumni.id, target: college.id, label: "mezunu; mezuniyet yılı 2018", kind: "relation" },
      { source: mentor.id, target: team.id, label: "mentor bağı", kind: "relation" },
    ],
  };
  const signals = await loadSignals();
  assert.equal(resolveCompany(alumni, index), null);
  assert.equal(companyFit(college, signals).value, 100);
  assert.equal(companyFit(team, signals).value, 20);
  const result = await mailQueue({ directory: null, index });
  assert.deepEqual(result.queue, []);
  assert.deepEqual(result.referral.map(({ id, reason }) => ({ id, reason })), [
    { id: "mentor", reason: "low-fit org" },
    { id: "mezun", reason: "no verified employer" },
  ]);
  assert.deepEqual(result.counts, { queue: 0, awaitingScan: 0, referral: 2, belowThreshold: 0, mailResearch: 0 });
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
      authority: "exec",
      fit: 50,
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
  assert.deepEqual(result.counts, { queue: 3, awaitingScan: 1, referral: 2, belowThreshold: 0, mailResearch: 4 });
  assert.deepEqual(result.queue.map(({ id, score }) => ({ id, score })), [
    { id: "kurucu", score: 81.62 },
    { id: "kapali", score: 78.05 },
    { id: "direktor", score: 65.3 },
  ]);
  assert.deepEqual(result.queue[0], {
    id: "kurucu",
    name: "Kurucu Aday",
    company_id: "oncelikli",
    company_name: "Öncelikli Şirket",
    authority: "founder",
    fit: 50,
    score: 81.62,
    reasons: [
      "Şirket önemi 80/100: Öncelikli Şirket importance değeri kullanıldı.",
      "Yetki 100/100: authority alanındaki founder seviyesi kullanıldı.",
      "Tarama derinliği 100/100: scan_state scanned, scan_depth 3 olarak değerlendirildi.",
      "Hook bonusu 68/100: 2 hook hesaba katıldı.",
      "Alıcı uyumu 50/100: Öncelikli Şirket için company tip profili kullanıldı.",
    ],
    mail_state: "none",
    scan_state: "scanned",
    mail_probe: "not_used",
  });
  assert.equal(result.queue[1].mail_state, "closed");
  assert.match(result.queue[2].reasons[0], /score değeri kullanıldı/);
  assert.equal(result.queue[2].reasons[1], "Yetki 80/100: 'teknoloji direktörü' kenar etiketi.");
  assert.deepEqual(result.awaitingScan, [
    {
      id: "kismi",
      name: "Kısmi Taranan",
      company_id: "acil",
      company_name: "Acil Şirket",
      authority: "exec",
      fit: 50,
      companyImportance: 95,
    },
  ]);
  assert.deepEqual(result.referral.map(({ id, reason }) => ({ id, reason })), [
    { id: "okul-sinyali", reason: "no verified employer" },
    { id: "taranmamis", reason: "no verified employer" },
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
  assert.equal(result.queue.find(({ id }) => id === "kurucu").score, 85.7);
  assert.equal(result.queue.find(({ id }) => id === "direktor").score, 65.3);
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
    headers: { "x-remote-user": "tuna" },
    payload: { reason: "uygun değil" },
  });
  assert.equal(rejected.statusCode, 200);
  assert.deepEqual(rejected.json(), {
    ok: true,
    id: rejectedDraft.id,
    status: "rejected",
    rejected: [rejectedDraft.id],
  });
  assert.equal(workspace.index.entities.get("direktor").meta.mail_state, "none");
  assert.equal((await readOutbox(workspace)).length, 1);
  assert.equal((await listMailDraftRecords(workspace)).length, 0);
  const [feedback] = await readFeedback(workspace);
  assert.deepEqual(feedback, {
    ts: feedback.ts,
    user: "tuna",
    draft_id: rejectedDraft.id,
    person_id: "direktor",
    company_id: "skorlu",
    kind: "other",
    text: "uygun değil",
  });
  assert.match(feedback.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test("approve users.yaml owner rolünü zorlar; staff reddedilir ve eksik dosyada default user owner olur", async (t) => {
  const root = await temporaryDirectory("outpost-mailer-roles-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(FIXTURE_WORKSPACES, "fixture"), path.join(root, "fixture"), {
    recursive: true,
  });
  const usersPath = path.join(root, "users.yaml");
  await fs.writeFile(usersPath, [
    "users:",
    "  - username: tuna",
    "    role: owner",
    "  - username: ada",
    "    role: staff",
    "",
  ].join("\n"), "utf8");
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    mailSchedule: false,
    followupSchedule: false,
    defaultUser: "tuna",
    usersPath,
  });
  t.after(() => app.close());
  const workspace = app.workspaceRegistry.get("fixture");
  const company = workspace.index.entities.get("oncelikli");
  const staffDraft = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("kurucu"), company,
    variants: variants(), score: 80, reasons: [],
  });
  const staff = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${staffDraft.id}/approve`,
    headers: { "x-remote-user": "ada" },
    payload: { variant: 0 },
  });
  assert.equal(staff.statusCode, 403);
  assert.deepEqual(staff.json(), { error: "approve yetkisi yalnız owner" });

  const owner = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${staffDraft.id}/approve`,
    headers: { "x-remote-user": "tuna" },
    payload: { variant: 0 },
  });
  assert.equal(owner.statusCode, 200);

  const missingUsers = path.join(root, "missing-users.yaml");
  const fallbackApp = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    mailSchedule: false,
    followupSchedule: false,
    defaultUser: "tuna",
    usersPath: missingUsers,
  });
  t.after(() => fallbackApp.close());
  const fallbackWorkspace = fallbackApp.workspaceRegistry.get("fixture");
  const fallbackDraft = await createMailDraftStage(fallbackWorkspace, {
    person: fallbackWorkspace.index.entities.get("direktor"),
    company: fallbackWorkspace.index.entities.get("skorlu"),
    variants: variants("Fallback"), score: 70, reasons: [],
  });
  const fallback = await fallbackApp.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${fallbackDraft.id}/approve`,
    payload: { variant: 1 },
  });
  assert.equal(fallback.statusCode, 200);
});

test("exclude-company kurumu vault'ta dışlar, aynı kurum taslaklarını cascade reddeder ve loglar", async (t) => {
  const { app, workspace } = await copiedApp(t);
  const company = workspace.index.entities.get("oncelikli");
  const first = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("kurucu"), company,
    variants: variants("Kurucu"), score: 87.2, reasons: [],
    now: () => new Date("2026-07-17T08:00:00Z"),
  });
  const second = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("taranmamis"), company,
    variants: variants("İkinci"), score: 60, reasons: [],
    now: () => new Date("2026-07-17T08:01:00Z"),
  });
  const untouched = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("direktor"),
    company: workspace.index.entities.get("skorlu"),
    variants: variants("Başka kurum"), score: 68, reasons: [],
    now: () => new Date("2026-07-17T08:02:00Z"),
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${first.id}/reject`,
    headers: { "x-remote-user": "tuna" },
    payload: { kind: "exclude-company", text: "tanıdık; bu kuruma yazılmayacak" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    id: first.id,
    status: "rejected",
    rejected: [first.id, second.id],
    company_excluded: { id: "oncelikli", name: "Öncelikli Şirket" },
  });
  const excluded = workspace.index.entities.get("oncelikli");
  assert.equal(excluded.meta.outreach, "excluded");
  assert.equal(excluded.meta.outreach_by, "tuna");
  assert.match(excluded.meta.outreach_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(excluded.meta.outreach_reason, "tanıdık; bu kuruma yazılmayacak");
  assert.equal(excluded.meta.outreach_note, undefined);
  assert.equal(workspace.index.entities.get("kurucu").meta.mail_state, "none");
  assert.equal(workspace.index.entities.get("taranmamis").meta.mail_state, "none");
  assert.deepEqual((await listMailDraftRecords(workspace)).map(({ id }) => id), [untouched.id]);

  const feedback = await readFeedback(workspace);
  assert.equal(feedback.length, 2);
  assert.deepEqual(feedback.map(({ draft_id, person_id, kind, text, cascade }) => ({
    draft_id, person_id, kind, text, cascade,
  })), [
    {
      draft_id: first.id,
      person_id: "kurucu",
      kind: "exclude-company",
      text: "tanıdık; bu kuruma yazılmayacak",
      cascade: undefined,
    },
    {
      draft_id: second.id,
      person_id: "taranmamis",
      kind: "exclude-company",
      text: "tanıdık; bu kuruma yazılmayacak",
      cascade: true,
    },
  ]);
  assert.ok(feedback.every((entry) =>
    entry.user === "tuna" && entry.company_id === "oncelikli" && entry.ts === feedback[0].ts));

  const queue = (await app.inject({ url: "/api/ws/fixture/mailqueue" })).json();
  assert.ok(![...queue.queue, ...queue.awaitingScan]
    .some(({ company_id }) => company_id === "oncelikli"));

  const exclusions = await app.inject({ url: "/api/ws/fixture/exclusions" });
  assert.equal(exclusions.statusCode, 200);
  assert.deepEqual(exclusions.json(), [{
    company_id: "oncelikli",
    name: "Öncelikli Şirket",
    by: "tuna",
    at: excluded.meta.outreach_at,
    reason: "tanıdık; bu kuruma yazılmayacak",
  }]);

  const denied = await app.inject({
    method: "DELETE",
    url: "/api/ws/fixture/exclusions/oncelikli",
    headers: { "x-remote-user": "ada" },
    payload: { text: "yanlış dışlama" },
  });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { error: "exclusion override yetkisi yalnız owner" });

  const overridden = await app.inject({
    method: "DELETE",
    url: "/api/ws/fixture/exclusions/oncelikli",
    headers: { "x-remote-user": "tuna" },
    payload: { text: "owner yeniden açtı" },
  });
  assert.equal(overridden.statusCode, 200);
  assert.deepEqual(overridden.json(), {
    ok: true, company_id: "oncelikli", status: "overridden",
  });
  assert.deepEqual((await app.inject({ url: "/api/ws/fixture/exclusions" })).json(), []);
  const cleared = workspace.index.entities.get("oncelikli").meta;
  for (const field of ["outreach", "outreach_by", "outreach_at", "outreach_reason", "outreach_note"]) {
    assert.equal(cleared[field], undefined);
  }
  const overrideLog = (await readFeedback(workspace)).at(-1);
  assert.deepEqual(overrideLog, {
    kind: "override-exclusion",
    user: "tuna",
    ts: overrideLog.ts,
    company_id: "oncelikli",
    text: "owner yeniden açtı",
  });
  assert.match(overrideLog.ts, /^\d{4}-\d{2}-\d{2}T/);

  const legacy = workspace.index.entities.get("skorlu");
  await fs.writeFile(legacy.filePath, serializeMarkdown(legacy.body, {
    ...legacy.meta,
    outreach: "excluded",
    outreach_note: "ada 2026-07-01: eski biçim nedeni",
  }), "utf8");
  await workspace.index.loadFile(legacy.filePath);
  assert.deepEqual((await app.inject({ url: "/api/ws/fixture/exclusions" })).json(), [{
    company_id: "skorlu",
    name: "Skorlu Şirket",
    by: "ada",
    at: "2026-07-01",
    reason: "eski biçim nedeni",
  }]);
});

test("know-person kişiyi mail_note ile kapatır ve etki özetini döndürür", async (t) => {
  const { app, workspace } = await copiedApp(t);
  const draft = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("direktor"),
    company: workspace.index.entities.get("skorlu"),
    variants: variants(), score: 68, reasons: [],
    now: () => new Date("2026-07-17T09:00:00Z"),
  });
  const response = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${draft.id}/reject`,
    headers: { "x-remote-user": "ada" },
    payload: { kind: "know-person", text: "yakından tanıyorum" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().person_closed, { id: "direktor", name: "Direktör Aday" });
  const person = workspace.index.entities.get("direktor");
  assert.equal(person.meta.mail_state, "closed");
  const [feedback] = await readFeedback(workspace);
  assert.equal(person.meta.mail_note, `ada ${feedback.ts.slice(0, 10)}: yakından tanıyorum`);
  assert.deepEqual({ kind: feedback.kind, text: feedback.text, user: feedback.user }, {
    kind: "know-person", text: "yakından tanıyorum", user: "ada",
  });
  assert.equal(workspace.index.entities.get("skorlu").meta.outreach, undefined);
});

test("wrong-person kişiyi not eklemeden kapatır, kurumu serbest bırakır", async (t) => {
  const { app, workspace } = await copiedApp(t);
  const draft = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("kurucu"),
    company: workspace.index.entities.get("oncelikli"),
    variants: variants(), score: 87.2, reasons: [],
    now: () => new Date("2026-07-17T10:00:00Z"),
  });
  const response = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${draft.id}/reject`,
    headers: { "x-remote-user": "tuna" },
    payload: { kind: "wrong-person", text: "yetkili kişi değil" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().person_closed, { id: "kurucu", name: "Kurucu Aday" });
  const person = workspace.index.entities.get("kurucu");
  assert.equal(person.meta.mail_state, "closed");
  assert.equal(person.meta.mail_note, undefined);
  assert.equal(workspace.index.entities.get("oncelikli").meta.outreach, undefined);
  const [feedback] = await readFeedback(workspace);
  assert.equal(feedback.kind, "wrong-person");
});

test("bad-content yalnız taslağı reddeder ve kişiyi yeniden yazılabilir durumda tutar", async (t) => {
  const { app, workspace } = await copiedApp(t);
  const draft = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("direktor"),
    company: workspace.index.entities.get("skorlu"),
    variants: variants(), score: 68, reasons: [],
    now: () => new Date("2026-07-17T11:00:00Z"),
  });
  const response = await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${draft.id}/reject`,
    headers: { "x-remote-user": "tuna" },
    payload: { kind: "bad-content", text: "hook zayıf" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().company_excluded, undefined);
  assert.equal(response.json().person_closed, undefined);
  assert.equal(workspace.index.entities.get("direktor").meta.mail_state, "none");
  assert.equal(workspace.index.entities.get("direktor").meta.mail_note, undefined);
  assert.equal(workspace.index.entities.get("skorlu").meta.outreach, undefined);
  const [feedback] = await readFeedback(workspace);
  assert.equal(feedback.kind, "bad-content");
  assert.equal(feedback.text, "hook zayıf");
});

test("writer kişinin son üç bad-content notunu variants promptuna ekler", async (t) => {
  const { workspace } = await copiedApp(t);
  await fs.mkdir(path.join(workspace.directory, "mails"), { recursive: true });
  const records = [
    "ilk eski not",
    "ikinci not",
    "üçüncü not",
    "en yeni not",
  ].map((text, index) => ({
    ts: `2026-07-1${index}T10:00:00.000Z`,
    user: "ada",
    draft_id: `eski-${index}`,
    person_id: "direktor",
    company_id: "skorlu",
    kind: "bad-content",
    text,
  }));
  records.splice(2, 0, {
    ts: "2026-07-12T09:00:00.000Z",
    user: "ada",
    person_id: "direktor",
    kind: "other",
    text: "prompta girmemeli",
  });
  await fs.writeFile(
    path.join(workspace.directory, "mails/feedback.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  const prompts = new Map();
  const result = await runMailWriterCycle({
    workspace,
    agent: { id: "writer-test", model: "test", params: { limit: 5 } },
    now: () => new Date("2026-07-17T12:00:00.000Z"),
    compileContext: async ({ person }) => person.id,
    generateVariants: async (context, options) => {
      prompts.set(context, options.extraPrompt);
      return variants(context);
    },
  });
  assert.ok(result.drafted > 0);
  assert.equal(prompts.get("direktor"), [
    "ÖNCEKİ RED NOTLARI (bunları düzelt):",
    "- ikinci not",
    "- üçüncü not",
    "- en yeni not",
  ].join("\n"));
  assert.doesNotMatch(prompts.get("direktor"), /ilk eski not|prompta girmemeli/);
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

test("uçtan uca: approve → schedule → dispatch dry-run → maildb", async (t) => {
  const { app, workspace } = await copiedApp(t);
  const person = workspace.index.entities.get("kurucu");
  const company = workspace.index.entities.get("oncelikli");
  const draft = await createMailDraftStage(workspace, {
    person, company, variants: variants(), score: 87, reasons: ["yüksek skor"],
    author: "tuna", generation: { model: "claude-sonnet-5", engine: "claude" },
    now: () => new Date("2026-07-16T21:00:00Z"),
  });
  const approved = (await app.inject({
    method: "POST",
    url: `/api/ws/fixture/maildrafts/${draft.id}/approve`,
    payload: { variant: 0 },
  })).json();
  // Onay ANINDA göndermez: bir saate schedule eder (gelecekte).
  assert.equal(approved.status, "approved");
  assert.ok(approved.scheduled_at, "scheduled_at dönmeli");
  assert.equal(approved.dispatch_mode, "dry_run");
  assert.ok(new Date(approved.scheduled_at).getTime() > Date.now());

  // Zamanı gelmeden dispatch bir şey yapmaz.
  const early = await dispatchDueSends(workspace, { now: () => new Date("2026-07-16T21:05:00Z") });
  assert.equal(early.processed, 0);

  // Planlanan saatten sonra: dry-run → dışarı gitmez, işaretlenir + render saklanır.
  const future = new Date(new Date(approved.scheduled_at).getTime() + 60_000);
  const run = await dispatchDueSends(workspace, { now: () => future });
  assert.equal(run.processed, 1);
  assert.equal(run.dry_run, 1);
  assert.equal(run.sent, 0);

  const [record] = await buildMailRecords(workspace, { now: () => future });
  assert.equal(record.send.status, "sent_dryrun");
  assert.equal(record.sent, true);
  assert.match(record.token, /^[a-f0-9]{16,}$/);
  const full = await (await import("../maildb.mjs")).mailRecord(workspace, record.id, { now: () => future });
  assert.ok(full.rendered?.message_id, "render edilmiş Message-ID saklanmalı");
  assert.match(full.rendered.html, /t\/o\/fixture\//, "izleme pikseli maile gömülmeli");

  const analytics = await mailAnalytics(workspace, { now: () => future });
  assert.equal(analytics.total, 1);
});
