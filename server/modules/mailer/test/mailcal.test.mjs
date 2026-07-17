import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { writeCalibration } from "../calibration.mjs";
import {
  approveMailDraft,
  createMailDraftStage,
  listMailDraftRecords,
  rejectMailDraft,
} from "../drafts.mjs";
import { appendUsage } from "../usage.mjs";
import { generateMailVariants, runMailWriterCycle } from "../writer.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(TEST_DIRECTORY, "fixtures", "workspaces", "fixture");

function variants(prefix = "V") {
  return [0, 1, 2].map((index) => ({
    subject: `${prefix} konu ${index}`,
    body: `${prefix} ayrı gövde ${index}`,
    rationale: `${prefix} ayrı açı ${index}`,
    tone: ["net", "teknik", "sıcak"][index],
  }));
}

function variantsJson(prefix = "V") {
  return JSON.stringify({ variants: variants(prefix) });
}

function sseEvents(response) {
  return response.body.split(/\r?\n/).filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

async function fixture(t, options = {}) {
  const root = await temporaryDirectory("outpost-mailcal-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(FIXTURE, path.join(root, "fixture"), { recursive: true });
  const usersPath = path.join(root, "users.yaml");
  await fs.writeFile(usersPath, [
    "users:",
    "  - username: tuna",
    "    name: Tuna Gül",
    "    role: owner",
    "  - username: ada",
    "    name: Ada Lovelace",
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
    ...options,
  });
  t.after(() => app.close());
  return { app, workspace: app.workspaceRegistry.get("fixture"), root, usersPath };
}

test("mail agent fake tmux ile opus session spawn eder ve [mail id] çıktısını SSE taşır", async (t) => {
  const id = "mail-fixed";
  let workspaceDirectory;
  let sessionExists = false;
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "has-session" && !sessionExists) throw new Error("oturum yok");
    if (args[0] === "new-session") sessionExists = true;
    if (args[0] === "capture-pane") return { stdout: "hazır\n❯\n" };
    return { stdout: "" };
  };
  const sleep = async (milliseconds) => {
    if (milliseconds !== 1) return;
    const outbox = path.join(workspaceDirectory, "mailagent", "tuna", "outbox");
    await fs.writeFile(path.join(outbox, `${id}.md`), "Kalibrasyon cevabı", "utf8");
    await fs.writeFile(path.join(outbox, `${id}.done`), "", "utf8");
  };
  const context = await fixture(t, {
    mailAgentExec: exec,
    mailAgentSleep: sleep,
    mailAgentSpawnWaitMs: 10,
    mailAgentBridgeOptions: { idFactory: () => id, outboxPollMs: 1 },
  });
  workspaceDirectory = context.workspace.directory;

  const response = await context.app.inject({
    method: "POST",
    url: "/api/ws/fixture/mailagent",
    headers: { "x-remote-user": "tuna" },
    payload: { message: "Üslubumu konuşalım", thread_id: "kal-1" },
  });
  assert.deepEqual(sseEvents(response), [
    { delta: "Kalibrasyon cevabı" },
    { done: true, thread_id: "kal-1" },
  ]);
  assert.ok(calls.some(([, args]) => args[0] === "new-session" &&
    args.includes("op-ws-fixture-usr-tuna-gul-mail") &&
    args.at(-1).includes("--model claude-opus-4-8")));
  assert.ok(calls.some(([, args]) => args.includes(`[mail ${id}] İstek: mailagent/tuna/inbox/${id}.md oku; cevabı mailagent/tuna/outbox/${id}.md dosyasına yaz; bitince mailagent/tuna/outbox/${id}.done oluştur.`)));
  const brief = await fs.readFile(
    path.join(workspaceDirectory, "mailagent", "tuna", "CLAUDE-MAIL.md"),
    "utf8",
  );
  assert.match(brief, /kalibrasyon.*ÜSTÜNDÜR/su);
  assert.match(brief, /Mail GÖNDEREMEZSİN/);
  const [usage] = (await fs.readFile(path.join(workspaceDirectory, "usage.jsonl"), "utf8"))
    .trim().split("\n").map(JSON.parse);
  assert.deepEqual({ user: usage.user, agent: usage.agent, kind: usage.kind, estimated: usage.estimated }, {
    user: "tuna", agent: "mail", kind: "chat", estimated: true,
  });
});

test("calibration GET boş şablon döndürür, PUT calibrated_at damgalar", async (t) => {
  const { app, workspace } = await fixture(t);
  const empty = await app.inject({
    url: "/api/ws/fixture/calibration",
    headers: { "x-remote-user": "ada" },
  });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json().calibrated_at, null);
  assert.match(empty.json().content, /Mail kalibrasyonu/);

  const put = await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/calibration",
    headers: { "x-remote-user": "ada" },
    payload: { content: "# Ada'nın kalemi\n\nKısa yaz.\n" },
  });
  assert.match(put.json().calibrated_at, /^\d{4}-\d{2}-\d{2}T/);
  const stored = await fs.readFile(
    path.join(workspace.directory, "mails", "calibration", "ada.md"),
    "utf8",
  );
  assert.match(stored, /calibrated_at:/);
  assert.match(stored, /Kısa yaz/);
});

test("writer stale pending taslağı limit içinde yeni adaylardan önce aynı id ile yeniler", async (t) => {
  const { app, workspace, usersPath } = await fixture(t);
  const person = workspace.index.entities.get("kurucu");
  const old = await createMailDraftStage(workspace, {
    person,
    company: workspace.index.entities.get("oncelikli"),
    variants: variants("Eski"),
    score: 80,
    reasons: ["öncelikli"],
    author: "tuna",
    now: () => new Date("2026-07-16T10:00:00.000Z"),
  });
  await writeCalibration(workspace, "tuna", "# Kalem\n", {
    now: () => new Date("2026-07-17T10:00:00.000Z"),
  });
  const before = (await app.inject({ url: "/api/ws/fixture/maildrafts" })).json();
  assert.equal(before.drafts.find(({ id }) => id === old.id).stale, true);
  const generated = [];
  const result = await runMailWriterCycle({
    workspace,
    usersPath,
    defaultUser: "tuna",
    agent: { id: "writer", model: "test", params: { limit: 1 } },
    now: () => new Date("2026-07-18T10:00:00.000Z"),
    compileContext: async ({ person: target }) => target.id,
    generateVariants: async (context, options) => {
      generated.push([context, options.usageKind]);
      return variants("Yeni");
    },
  });
  assert.deepEqual(generated, [["kurucu", "redraft"]]);
  assert.equal(result.redrafted, 1);
  assert.equal(result.drafts[0].id, old.id);
  const [rewritten] = await listMailDraftRecords(workspace);
  assert.equal(rewritten.id, old.id);
  assert.equal(rewritten.created_at, "2026-07-18T10:00:00.000Z");
  assert.equal(rewritten.variants[0].subject, "Yeni konu 0");
});

test("varyant üretimi mail agent yolunu kullanır ve köprü hatasında headless Claude'a düşer", async (t) => {
  const { workspace } = await fixture(t);
  await writeCalibration(workspace, "tuna", "# Kalem\n\nCümleleri kısa tut.\n");
  let agentPrompt = "";
  const fromAgent = await generateMailVariants("bağlam", {
    workspace,
    agent: { model: "test" },
    author: "tuna",
    authorName: "Tuna Gül",
    skillNames: [],
    mailBridge: async (prompt) => {
      agentPrompt = prompt;
      return (async function* output() { yield variantsJson("Agent"); })();
    },
    runClaude: async () => assert.fail("başarılı mail agent sonrası fallback olmamalı"),
  });
  assert.equal(fromAgent[0].subject, "Agent konu 0");
  assert.match(agentPrompt, /Cümleleri kısa tut/);
  assert.ok(agentPrompt.indexOf("KULLANICI KALİBRASYONU") < agentPrompt.indexOf("BAĞLAM PAKETİ"));

  const warnings = [];
  const fallback = await generateMailVariants("bağlam", {
    workspace,
    agent: { model: "test" },
    author: "tuna",
    skillNames: [],
    mailBridge: async () => { throw new Error("tmux kapalı"); },
    runClaude: async () => variantsJson("Fallback"),
    logger: { warn: (...args) => warnings.push(args) },
  });
  assert.equal(fallback[0].subject, "Fallback konu 0");
  assert.equal(warnings.length, 1);
});

test("users/stats stage, outbox, feedback ve usage kayıtlarını kullanıcı bazında toplar", async (t) => {
  const { app, workspace } = await fixture(t);
  const company = workspace.index.entities.get("oncelikli");
  const approved = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("kurucu"), company,
    variants: variants("A"), score: 1, reasons: [], author: "tuna",
  });
  await approveMailDraft(workspace, approved.id, { variant: 0 });
  const rejected = await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("taranmamis"), company,
    variants: variants("R"), score: 1, reasons: [], author: "ada",
  });
  await rejectMailDraft(workspace, rejected.id, { kind: "bad-content", text: "zayıf" }, {
    user: "tuna",
  });
  await createMailDraftStage(workspace, {
    person: workspace.index.entities.get("direktor"),
    company: workspace.index.entities.get("skorlu"),
    variants: variants("P"), score: 1, reasons: [], author: "tuna",
  });
  await appendUsage(workspace, {
    user: "tuna", agent: "mail", kind: "draft",
    tokens_in: 100, tokens_out: 40, chars: 400,
  });
  await appendUsage(workspace, {
    user: "ada", agent: "mail", kind: "chat", chars_in: 8, chars_out: 12,
  });
  const stats = (await app.inject({ url: "/api/ws/fixture/users/stats" })).json();
  assert.deepEqual(stats.find(({ user }) => user === "tuna"), {
    user: "tuna", name: "Tuna Gül", role: "owner",
    drafts: 2, approved: 1, rejected: 0,
    tokens: { in: 100, out: 40, estimated: false },
  });
  assert.deepEqual(stats.find(({ user }) => user === "ada"), {
    user: "ada", name: "Ada Lovelace", role: "staff",
    drafts: 1, approved: 0, rejected: 1,
    tokens: { in: 2, out: 3, estimated: true },
  });
});

test("personal-agents kimlikli kullanıcının assistant ve mail session durumunu döndürür", async (t) => {
  const exec = async (_command, args) => {
    if (args.at(-1).endsWith("-mail")) throw new Error("mail kapalı");
    return { stdout: "" };
  };
  const { app, workspace } = await fixture(t, { mailAgentExec: exec });
  await fs.mkdir(path.join(workspace.directory, "assistant", "ada", "outbox"), {
    recursive: true,
  });
  const response = await app.inject({
    url: "/api/ws/fixture/personal-agents",
    headers: { "x-remote-user": "ada" },
  });
  assert.equal(response.statusCode, 200);
  const agents = response.json();
  assert.deepEqual(agents.map(({ kind, session, running }) => ({ kind, session, running })), [
    { kind: "assistant", session: "op-ws-fixture-usr-ada-lovelace", running: true },
    { kind: "mail", session: "op-ws-fixture-usr-ada-lovelace-mail", running: false },
  ]);
  assert.match(agents[0].lastActivity, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(agents[1].lastActivity, null);
});
