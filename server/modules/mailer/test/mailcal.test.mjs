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

function draftJson(prefix = "Studio") {
  return JSON.stringify({
    subject: `${prefix} konu`,
    body: `${prefix} gövde`,
    rationale: `${prefix} gerekçe`,
  });
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

test("Calibration Studio feedback'i voice'tan önce işler, tek taslağı stream edip önceki session kaydına bağlar", async (t) => {
  const prompts = [];
  const bridge = async (prompt) => {
    prompts.push(prompt);
    const output = prompt.includes("GERİ BİLDİRİM:") ? "voice güncellendi" : draftJson(`D${prompts.length}`);
    return (async function* stream() {
      yield output.slice(0, 12);
      yield output.slice(12);
    })();
  };
  const { app, workspace } = await fixture(t, {
    mailAgentBridge: bridge,
    mailAgentCompileContext: async ({ person }) => `bağlam:${person.id}`,
  });

  const first = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/calibration/draft",
    headers: { "x-remote-user": "tuna" },
    payload: { person_id: "kurucu" },
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(sseEvents(first).at(-1), {
    done: true,
    draft: { subject: "D1 konu", body: "D1 gövde", rationale: "D1 gerekçe" },
  });

  const second = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/calibration/draft",
    headers: { "x-remote-user": "tuna" },
    payload: {
      person_id: "kurucu",
      feedback: { rating: 4, liked: "Kısa oluşu", disliked: "Kapanış" },
    },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(prompts.length, 3);
  assert.match(prompts[1], /voice dosyana işle/);
  assert.match(prompts[1], /Kısa oluşu/);
  assert.match(prompts[2], /TEK bir gerçek outreach mail taslağı/);
  assert.match(prompts[2], /bağlam:kurucu/);
  const records = (await fs.readFile(
    path.join(workspace.directory, "mails/calibration/sessions/tuna.jsonl"), "utf8",
  )).trim().split("\n").map(JSON.parse);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].feedback, {
    rating: 4, liked: "Kısa oluşu", disliked: "Kapanış",
  });
  assert.equal(records[1].draft.subject, "D3 konu");
  const calibration = (await app.inject({
    url: "/api/ws/fixture/calibration",
    headers: { "x-remote-user": "tuna" },
  })).json();
  assert.match(calibration.calibrated_at, /^\d{4}-\d{2}-\d{2}T/);

  const invalid = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/calibration/draft",
    headers: { "x-remote-user": "tuna" },
    payload: { person_id: "mailsiz" },
  });
  assert.equal(invalid.statusCode, 404);
});

test("kullanıcı skill API'si markdown/JSON CRUD, boyut ve 12 dosya limitlerini uygular", async (t) => {
  const { app } = await fixture(t);
  const headers = { "x-remote-user": "ada" };
  const markdown = await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/calibration/skills/net-yaz.md",
    headers: { ...headers, "content-type": "text/markdown" },
    payload: "# Net yaz\n\nÜç cümleyi geçme.\n",
  });
  assert.equal(markdown.statusCode, 200);
  assert.equal(markdown.json().size, Buffer.byteLength("# Net yaz\n\nÜç cümleyi geçme.\n"));
  const updated = await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/calibration/skills/net-yaz.md",
    headers,
    payload: { content: "# Net\n\nİki cümle." },
  });
  assert.equal(updated.statusCode, 200);
  const listed = await app.inject({
    url: "/api/ws/fixture/calibration/skills",
    headers,
  });
  assert.deepEqual(listed.json(), [{
    name: "net-yaz.md",
    size: Buffer.byteLength("# Net\n\nİki cümle."),
    content: "# Net\n\nİki cümle.",
  }]);
  const badName = await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/calibration/skills/Buyuk.md",
    headers,
    payload: { content: "x" },
  });
  assert.equal(badName.statusCode, 400);
  const tooLarge = await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/calibration/skills/buyuk.md",
    headers,
    payload: { content: "x".repeat(64 * 1024 + 1) },
  });
  assert.equal(tooLarge.statusCode, 413);
  for (let index = 1; index < 12; index += 1) {
    const response = await app.inject({
      method: "PUT",
      url: `/api/ws/fixture/calibration/skills/kural-${index}.md`,
      headers,
      payload: { content: `kural ${index}` },
    });
    assert.equal(response.statusCode, 200);
  }
  const thirteenth = await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/calibration/skills/fazla.md",
    headers,
    payload: { content: "fazla" },
  });
  assert.equal(thirteenth.statusCode, 409);
  const removed = await app.inject({
    method: "DELETE",
    url: "/api/ws/fixture/calibration/skills/net-yaz.md",
    headers,
  });
  assert.deepEqual(removed.json(), { deleted: true, name: "net-yaz.md" });
  const raced = await Promise.all(["yarisan-a.md", "yarisan-b.md"].map((name) => app.inject({
    method: "PUT",
    url: `/api/ws/fixture/calibration/skills/${name}`,
    headers,
    payload: { content: name },
  })));
  assert.deepEqual(raced.map(({ statusCode }) => statusCode).sort(), [200, 409]);
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

test("writer kullanıcı skill'ini kanonik skill'den sonra ve voice'tan önce prompta koyar", async (t) => {
  const { workspace } = await fixture(t);
  await fs.mkdir(path.join(workspace.directory, "mails/calibration/skills/tuna"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(workspace.directory, "mails/calibration/skills/tuna/ozel.md"),
    "BENİM ÖZEL KURALIM",
    "utf8",
  );
  await writeCalibration(workspace, "tuna", "VOICE KURALIM");
  let prompt = "";
  await generateMailVariants("BAĞLAMIM", {
    workspace,
    agent: { model: "test" },
    author: "tuna",
    skillNames: ["tone-map.md"],
    mailBridge: async (value) => {
      prompt = value;
      return (async function* output() { yield variantsJson("Skill"); })();
    },
  });
  assert.match(prompt, /KULLANICI SKILL'LERİ KANONİK SKILL'LERLE ÇELİŞİRSE KULLANICI SKILL'LERİ KAZANIR/);
  assert.ok(prompt.indexOf("tone-map.md") < prompt.indexOf("BENİM ÖZEL KURALIM"));
  assert.ok(prompt.indexOf("BENİM ÖZEL KURALIM") < prompt.indexOf("VOICE KURALIM"));
  assert.ok(prompt.indexOf("VOICE KURALIM") < prompt.indexOf("BAĞLAMIM"));
});

test("mail agent config model geçişinde session'ı kill eder; Sonnet spawn ve GPT chat 409 çalışır", async (t) => {
  const id = "mail-model";
  let workspaceDirectory;
  let sessionExists = false;
  const calls = [];
  const exec = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "has-session" && !sessionExists) throw new Error("oturum yok");
    if (args[0] === "new-session") sessionExists = true;
    if (args[0] === "kill-session") sessionExists = false;
    if (args[0] === "capture-pane") return { stdout: "hazır\n❯\n" };
    return { stdout: "" };
  };
  const sleep = async (milliseconds) => {
    if (milliseconds !== 1) return;
    const outbox = path.join(workspaceDirectory, "mailagent", "tuna", "outbox");
    await fs.writeFile(path.join(outbox, `${id}.md`), "Sonnet yanıtı", "utf8");
    await fs.writeFile(path.join(outbox, `${id}.done`), "", "utf8");
  };
  const context = await fixture(t, {
    mailAgentExec: exec,
    mailAgentSleep: sleep,
    mailAgentSpawnWaitMs: 10,
    mailAgentBridgeOptions: { idFactory: () => id, outboxPollMs: 1 },
  });
  workspaceDirectory = context.workspace.directory;
  const headers = { "x-remote-user": "tuna" };
  assert.deepEqual((await context.app.inject({
    url: "/api/ws/fixture/mailagent/config", headers,
  })).json(), { model: "claude-opus-4-8" });
  const sonnet = await context.app.inject({
    method: "PUT",
    url: "/api/ws/fixture/mailagent/config",
    headers,
    payload: { model: "claude-sonnet-5" },
  });
  assert.deepEqual(sonnet.json(), { model: "claude-sonnet-5" });
  assert.ok(calls.some(([, args]) => args[0] === "kill-session"));
  const chat = await context.app.inject({
    method: "POST",
    url: "/api/ws/fixture/mailagent",
    headers,
    payload: { message: "Merhaba" },
  });
  assert.equal(sseEvents(chat)[0].delta, "Sonnet yanıtı");
  assert.ok(calls.some(([, args]) => args[0] === "new-session" &&
    args.at(-1).includes("--model claude-sonnet-5")));

  await context.app.inject({
    method: "PUT",
    url: "/api/ws/fixture/mailagent/config",
    headers,
    payload: { model: "gpt-5.6-sol" },
  });
  const gptChat = await context.app.inject({
    method: "POST",
    url: "/api/ws/fixture/mailagent",
    headers,
    payload: { message: "Merhaba" },
  });
  assert.equal(gptChat.statusCode, 409);
  assert.deepEqual(gptChat.json(), { error: "chat bu modelde yok" });
  const luna = await context.app.inject({
    method: "PUT",
    url: "/api/ws/fixture/mailagent/config",
    headers,
    payload: { model: "gpt-5.6-luna" },
  });
  assert.equal(luna.statusCode, 400);
});

test("writer GPT config'inde tmux/Claude yerine gpt-5.6-sol koşusunu ve Codex token usage'ını kullanır", async (t) => {
  const { app, workspace } = await fixture(t, {
    mailAgentExec: async () => { throw new Error("oturum yok"); },
  });
  await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/mailagent/config",
    headers: { "x-remote-user": "tuna" },
    payload: { model: "gpt-5.6-sol" },
  });
  let options;
  const result = await generateMailVariants("gpt bağlam", {
    workspace,
    agent: { model: "pipeline-model", params: {} },
    author: "tuna",
    skillNames: [],
    mailBridge: async () => assert.fail("GPT config tmux köprüsünü kullanmamalı"),
    runClaude: async () => assert.fail("GPT config Claude kullanmamalı"),
    runLuna: async (_prompt, received) => {
      options = received;
      return {
        text: variantsJson("GPT"),
        usage: { tokens_in: 321, tokens_out: 123, estimated: false },
      };
    },
  });
  assert.equal(result[0].subject, "GPT konu 0");
  assert.equal(options.model, "gpt-5.6-sol");
  assert.equal(options.recordUsage, false);
  const usage = (await fs.readFile(path.join(workspace.directory, "usage.jsonl"), "utf8"))
    .trim().split("\n").map(JSON.parse).at(-1);
  assert.deepEqual({ agent: usage.agent, kind: usage.kind, in: usage.tokens_in, out: usage.tokens_out }, {
    agent: "codex", kind: "draft", in: 321, out: 123,
  });
});

test("Calibration Studio GPT modunda koşu-başına Codex üretir ve feedback voice çıktısını güvenli yazar", async (t) => {
  const calls = [];
  const runCodex = async (prompt, options) => {
    calls.push({ prompt, options });
    if (prompt.includes("mevcut mail voice metnine işle")) {
      return {
        text: JSON.stringify({ content: "# GPT voice\n\nKısa ve doğrudan yaz." }),
        usage: { tokens_in: 20, tokens_out: 10, estimated: false },
      };
    }
    return {
      text: draftJson(`GPT${calls.length}`),
      usage: { tokens_in: 40, tokens_out: 15, estimated: false },
    };
  };
  const { app, workspace } = await fixture(t, {
    mailAgentExec: async () => { throw new Error("oturum yok"); },
    mailAgentCodex: runCodex,
    mailAgentCompileContext: async ({ person }) => `gpt-bağlam:${person.id}`,
  });
  const headers = { "x-remote-user": "tuna" };
  await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/mailagent/config",
    headers,
    payload: { model: "gpt-5.6-sol" },
  });
  await app.inject({
    method: "POST",
    url: "/api/ws/fixture/calibration/draft",
    headers,
    payload: { person_id: "kurucu" },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/calibration/draft",
    headers,
    payload: { person_id: "kurucu", feedback: { rating: 5, liked: "Net" } },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ options }) => options.model === "gpt-5.6-sol"));
  assert.match(calls[1].prompt, /GERİ BİLDİRİM/);
  assert.match(calls[2].prompt, /gpt-bağlam:kurucu/);
  assert.equal(sseEvents(response).at(-1).draft.subject, "GPT3 konu");
  const voice = await fs.readFile(
    path.join(workspace.directory, "mails/calibration/tuna.md"), "utf8",
  );
  assert.match(voice, /calibrated_at:/);
  assert.match(voice, /Kısa ve doğrudan yaz/);
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
