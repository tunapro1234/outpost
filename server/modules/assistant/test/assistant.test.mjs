import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { ensureAssistantBrief } from "../service.mjs";

async function fixture(t) {
  const root = await temporaryDirectory("outpost-assistant-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  await fs.mkdir(path.join(directory, "vault"), { recursive: true });
  await fs.writeFile(path.join(directory, "config.yaml"), "name: Fixture\n", "utf8");
  return { root, directory };
}

function sseEvents(response) {
  return response.body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

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
  const outbox = path.join(directory, "assistant", "ada", "outbox");
  let sessionExists = false;

  const exec = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "has-session" && !sessionExists) {
      throw new Error("can't find session");
    }
    if (args[0] === "new-session") sessionExists = true;
    if (args[0] === "capture-pane") return { stdout: "hazır\n❯\nesc to interrupt\n" };
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
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/assistant",
    headers: { "x-remote-user": "ada" },
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
  assert.match(brief, /Sen \*\*ada\*\* kullanıcısının \*\*fixture\*\*/);
  assert.match(brief, /SALT-OKUR/);
  assert.match(brief, /notes\.last_context/);
  assert.match(brief, /X-Remote-User: ada/);
  assert.doesNotMatch(brief, /\{\{user\}\}|\{\{ws\}\}/);

  assert.deepEqual(calls, [
    ["tmux", ["has-session", "-t", "outpost-user-ada"]],
    ["tmux", [
      "new-session", "-d", "-s", "outpost-user-ada", "-c", directory,
      "/opt/claude bin/claude --dangerously-skip-permissions --model claude-sonnet-5",
    ]],
    ["tmux", [
      "send-keys", "-t", "outpost-user-ada", "-l",
      "talimat dosyanı oku; protokol: [assist <id>] mesajları",
    ]],
    ["tmux", ["send-keys", "-t", "outpost-user-ada", "Enter"]],
    ["tmux", ["capture-pane", "-p", "-t", "outpost-user-ada"]],
    ["tmux", [
      "send-keys", "-t", "outpost-user-ada", "-l",
      `[assist ${id}] Soru: assistant/ada/inbox/${id}.md oku; cevabı assistant/ada/outbox/${id}.md dosyasına markdown olarak yaz; bitince assistant/ada/outbox/${id}.done oluştur.`,
    ]],
    ["tmux", ["send-keys", "-t", "outpost-user-ada", "Enter"]],
  ]);
  await assert.rejects(
    fs.access(path.join(directory, "assistant", "ada", "inbox", `${id}.md`)),
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
