import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { agentSlug, ensureAssistantBrief, personalAgentSession } from "../service.mjs";

async function fixture(t) {
  const root = await temporaryDirectory("outpost-assistant-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  await fs.mkdir(path.join(directory, "vault"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "config.yaml"),
    "name: Fixture\ncode: prb\n",
    "utf8",
  );
  return { root, directory };
}

function sseEvents(response) {
  return response.body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

test("personal agent slug'ı Türkçe karakterleri ASCII'ye çevirir", () => {
  assert.equal(agentSlug("İÜĞŞÇÖ ıüç!? Ada"), "iugsco-iuc-ada");
  assert.equal(
    personalAgentSession({ id: "probot", code: "prb" }, "Tuna Gül", "tuna"),
    "op-ws-prb-usr-tuna-gul",
  );
  assert.equal(
    personalAgentSession({ id: "fixture" }, "", "ada"),
    "op-ws-fixture-usr-ada",
  );
});

test("assistant kimliksiz isteği reddeder ve shell-güvensiz kullanıcıyla tmux çağırmaz", async (t) => {
  const { root, directory } = await fixture(t);
  const calls = [];
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    defaultUser: "",
    assistantExec: async (...args) => calls.push(args),
  });
  t.after(() => app.close());

  const anonymous = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/assistant",
    payload: { message: "Merhaba" },
  });
  assert.equal(anonymous.statusCode, 401);

  const malicious = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/assistant",
    headers: { "x-remote-user": "ada;touch-pwn" },
    payload: { message: "Merhaba" },
  });
  assert.equal(malicious.statusCode, 400);
  assert.deepEqual(calls, []);
  await assert.rejects(fs.access(path.join(directory, "assistant")), { code: "ENOENT" });
});

test("assistant oturumu spawn eder, brief üretir ve dosya protokolünü SSE olarak stream eder", async (t) => {
  const { root, directory } = await fixture(t);
  const calls = [];
  const id = "assist-fixed";
  const user = "tuna";
  const session = "op-ws-prb-usr-tuna-gul";
  const outbox = path.join(directory, "assistant", user, "outbox");
  const usersPath = path.join(root, "users.yaml");
  await fs.writeFile(
    usersPath,
    "users:\n  - username: tuna\n    name: Tuna Gül\n",
    "utf8",
  );
  let sessionExists = false;

  const exec = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "has-session" && !sessionExists) {
      throw new Error("can't find session");
    }
    if (args[0] === "new-session") sessionExists = true;
    if (args[0] === "capture-pane") return { stdout: "hazır\n❯\n" };
    return { stdout: "" };
  };
  const sleep = async (milliseconds) => {
    if (milliseconds === 1) {
      await fs.writeFile(path.join(outbox, `${id}.md`), "Merhaba Ada", "utf8");
      await fs.writeFile(path.join(outbox, `${id}.done`), "", "utf8");
    }
  };
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    defaultUser: "",
    assistantExec: exec,
    assistantSleep: sleep,
    assistantClaudeBin: "/opt/claude bin/claude",
    assistantSpawnWaitMs: 10, // pollMs=2 olsun ki bridge'in sleep(1) tetiğiyle çakışmasın
    assistantBridgeOptions: { idFactory: () => id, outboxPollMs: 1 },
    usersPath,
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/assistant",
    headers: { "x-remote-user": user },
    payload: { message: " Bugün neye bakayım? ", thread_id: "gunluk-1" },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^text\/event-stream/);
  assert.deepEqual(sseEvents(response), [
    { delta: "Merhaba Ada" },
    { done: true, thread_id: "gunluk-1" },
  ]);

  const brief = await fs.readFile(
    path.join(directory, "assistant", "CLAUDE-ASSIST.md"),
    "utf8",
  );
  assert.match(brief, /Sen \*\*tuna\*\* kullanıcısının \*\*fixture\*\*/);
  assert.match(brief, /SALT-OKUR/);
  assert.match(brief, /notes\.last_context/);
  assert.match(brief, /X-Remote-User: tuna/);
  assert.match(brief, /bad-content/);
  assert.match(brief, /exclude-company/);
  assert.match(brief, /approve yetkin yoktur/);
  assert.match(brief, /\[ask tuna <id>\]/);
  assert.match(brief, /tmux send-keys -t op-ws-prb/);
  assert.doesNotMatch(brief, /\{\{user\}\}|\{\{ws\}\}|\{\{code\}\}/);

  assert.deepEqual(calls, [
    ["tmux", ["has-session", "-t", session]],
    ["tmux", [
      "new-session", "-d", "-s", session, "-c", directory,
      "IS_SANDBOX=1 /opt/claude bin/claude --dangerously-skip-permissions --model claude-sonnet-5",
    ]],
    // TUI hazır-bekleme kontrolü
    ["tmux", ["capture-pane", "-t", session, "-p"]],
    ["tmux", [
      "send-keys", "-t", session, "-l",
      "talimat dosyanı oku; protokol: [assist <id>] mesajları",
    ]],
    ["tmux", ["send-keys", "-t", session, "Enter"]],
    // brief Enter-tekrar kontrolü (pane temiz → tek bakış)
    ["tmux", ["capture-pane", "-t", session, "-p"]],
    // köprünün meşguliyet kontrolü
    ["tmux", ["capture-pane", "-p", "-t", session]],
    ["tmux", [
      "send-keys", "-t", session, "-l",
      `[assist ${id}] Soru: assistant/tuna/inbox/${id}.md oku; cevabı assistant/tuna/outbox/${id}.md dosyasına markdown olarak yaz; bitince assistant/tuna/outbox/${id}.done oluştur.`,
    ]],
    ["tmux", ["send-keys", "-t", session, "Enter"]],
    // köprü Enter-tekrar kontrolü
    ["tmux", ["capture-pane", "-p", "-t", session]],
  ]);
  await assert.rejects(
    fs.access(path.join(directory, "assistant", user, "inbox", `${id}.md`)),
    { code: "ENOENT" },
  );
});

test("assistant brief mevcutsa dokunmaz, spawn hatasını anlaşılır SSE hatası yapar", async (t) => {
  const { root, directory } = await fixture(t);
  const workspace = { id: "fixture", directory };
  const briefDirectory = path.join(directory, "assistant");
  const briefPath = path.join(briefDirectory, "CLAUDE-ASSIST.md");
  await fs.mkdir(briefDirectory, { recursive: true });
  await fs.writeFile(briefPath, "özel mevcut talimat", "utf8");
  await ensureAssistantBrief(workspace, "ada");
  assert.equal(await fs.readFile(briefPath, "utf8"), "özel mevcut talimat");

  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    defaultUser: "ada",
    assistantExec: async (_command, args) => {
      if (args[0] === "has-session") throw new Error("oturum yok");
      throw new Error("tmux çalıştırılamadı");
    },
    assistantSleep: async () => {},
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/assistant",
    payload: { message: "Merhaba" },
  });
  assert.equal(response.statusCode, 200);
  const events = sseEvents(response);
  assert.match(events[0].error, /Asistan tmux oturumu başlatılamadı/);
  assert.equal(events[1].done, true);
  assert.match(events[1].thread_id, /^[0-9a-f-]{36}$/);
});
