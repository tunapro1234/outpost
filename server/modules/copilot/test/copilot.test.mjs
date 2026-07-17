import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { runClaude } from "../runner.mjs";
import { WorkspaceRegistry } from "../../../lib/config.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../../../test-support/helpers.mjs";
import { createRunRecord, writeRun } from "../../gather/journal.mjs";
import { buildCopilotPrompt, workspaceSummary } from "../context.mjs";
import { createTmuxBridge } from "../tmux-bridge.mjs";

// createApp köprüyü varsayılan bağımlılıklarıyla kurar. Test sürecinde canlı bir
// outpost-copilot oturumuna hiçbir koşulda mesaj göndermemek için benzersiz ad kullan.
process.env.OUTPOST_COPILOT_TMUX = `outpost-copilot-test-${process.pid}`;

async function fixture(t) {
  const root = await temporaryDirectory("outpost-copilot-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  const vault = path.join(directory, "vault");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "config.yaml"), "name: Fixture\n", "utf8");
  await writeEntity(
    vault,
    "companies",
    "bir",
    serializeMarkdown("", { type: "company", name: "Bir", status: "aday" }),
  );
  await writeEntity(
    vault,
    "people",
    "iki",
    serializeMarkdown("", { type: "person", name: "İki", status: "cevap" }),
  );
  return { root, directory };
}

function sseEvents(response) {
  return response.body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

test("copilot owner gate header/default kullanıcıyı kabul eder, kimliksizi 401 ile reddeder", async (t) => {
  const { root, directory } = await fixture(t);
  let calls = 0;
  const runner = async function* () {
    calls += 1;
    yield "ok";
  };
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    copilotRunner: runner,
    defaultUser: "tuna",
  });
  t.after(() => app.close());

  assert.deepEqual(
    (await app.inject({ url: "/api/ws/fixture/copilot/enabled" })).json(),
    { enabled: true },
  );
  assert.deepEqual(
    (await app.inject({
      url: "/api/ws/fixture/copilot/enabled",
      headers: { "x-remote-user": "tuna" },
    })).json(),
    { enabled: true },
  );
  assert.deepEqual(
    (await app.inject({
      url: "/api/ws/fixture/copilot/enabled",
      headers: { "x-remote-user": "başkası" },
    })).json(),
    { enabled: false },
  );

  const denied = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/copilot",
    headers: { "x-remote-user": "başkası" },
    payload: { message: "Merhaba" },
  });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.json(), { error: "copilot is owner-only" });
  assert.equal(calls, 0);
  await assert.rejects(fs.access(path.join(directory, "copilot-threads")), { code: "ENOENT" });
  assert.equal((await app.inject({ url: "/api/copilot/enabled" })).statusCode, 404);

  const anonymousApp = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    copilotRunner: runner,
    defaultUser: "",
  });
  t.after(() => anonymousApp.close());
  assert.deepEqual(
    (await anonymousApp.inject({ url: "/api/ws/fixture/copilot/enabled" })).json(),
    { enabled: false },
  );
  const anonymous = await anonymousApp.inject({
    method: "POST",
    url: "/api/ws/fixture/copilot",
    payload: { message: "Merhaba" },
  });
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.json(), { error: "authentication required" });
});

test("workspace promptu stats/run/mail/stage özetini toplar, son beşi seçer ve secret redakte eder", async (t) => {
  const { root, directory } = await fixture(t);
  const registry = await WorkspaceRegistry.load({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
  });
  t.after(() => registry.close());
  const workspace = registry.get("fixture");

  for (let index = 0; index < 6; index += 1) {
    const run = createRunRecord("tarayici", {
      now: () => new Date(`2026-07-${String(10 + index).padStart(2, "0")}T10:00:00.000Z`),
    });
    run.status = "ok";
    run.ended = run.started;
    run.items_in = index;
    run.note = index === 5 ? "password: run-secret" : `run-${index}`;
    await writeRun(workspace, run);
  }

  await fs.mkdir(path.join(directory, "mails"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "mails", "log.jsonl"),
    `${JSON.stringify({
      id: "mail-1",
      entity_id: "iki",
      direction: "in",
      date: "2026-07-16",
      from: "iki@example.com",
      to: "tuna@example.com",
      subject: "Yanıt",
      summary: "Bearer mail-secret-token",
      source: "manual",
    })}\n`,
    "utf8",
  );
  await fs.mkdir(path.join(directory, "stage"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "stage", "onerim.md"),
    serializeMarkdown("", {
      type: "company",
      name: "Bir",
      entity_id: "bir",
      gather_summary: "api_key=stage-secret",
    }),
    "utf8",
  );

  const summary = await workspaceSummary(workspace);
  assert.deepEqual(summary.stats, {
    total: 2,
    byType: { company: 1, person: 1 },
    byStatus: { aday: 1, cevap: 1 },
    edgeCount: 0,
  });
  assert.equal(summary.recentRuns.length, 5);
  assert.equal(summary.recentRuns[0].started, "2026-07-15T10:00:00.000Z");
  assert.equal(summary.recentMails.length, 1);
  assert.equal(summary.pendingStage.count, 1);

  const prompt = buildCopilotPrompt({
    summary,
    history: [{ role: "assistant", content: "access_token=history-secret" }],
    message: "Şifre: user-secret ile kaç entity var?",
  });
  assert.match(prompt, /"total": 2/);
  assert.match(prompt, /"count": 1/);
  assert.doesNotMatch(prompt, /run-secret|mail-secret-token|stage-secret|history-secret|user-secret/);
  assert.match(prompt, /\[REDACTED/);
  assert.match(prompt, /Araç çalıştırma/);
});

test("copilot SSE deltaları ve done eventini yollar, thread geçmişini sonraki prompta katar", async (t) => {
  const { root, directory } = await fixture(t);
  const prompts = [];
  const runner = async function* (prompt) {
    prompts.push(prompt);
    yield "İki ";
    yield "entity var.";
  };
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    copilotRunner: runner,
    defaultUser: "tuna",
  });
  t.after(() => app.close());

  const first = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/copilot",
    payload: { message: "Kaç entity var?" },
  });
  assert.equal(first.statusCode, 200);
  assert.match(first.headers["content-type"], /^text\/event-stream/);
  const firstEvents = sseEvents(first);
  assert.deepEqual(firstEvents.slice(0, 2), [
    { delta: "İki " },
    { delta: "entity var." },
  ]);
  assert.equal(firstEvents[2].done, true);
  assert.match(firstEvents[2].thread_id, /^[0-9a-f-]{36}$/);

  const threadId = firstEvents[2].thread_id;
  const second = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/copilot",
    headers: { "x-remote-user": "tuna" },
    payload: { message: "Emin misin?", thread_id: threadId },
  });
  assert.equal(second.statusCode, 200);
  assert.match(prompts[1], /Kaç entity var\?/);
  assert.match(prompts[1], /İki entity var\./);

  const records = (await fs.readFile(
    path.join(directory, "copilot-threads", `${threadId}.jsonl`),
    "utf8",
  )).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(records.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "Kaç entity var?" },
    { role: "assistant", content: "İki entity var." },
    { role: "user", content: "Emin misin?" },
    { role: "assistant", content: "İki entity var." },
  ]);
});

test("runner hatası HTTP 500 yerine error ve done SSE eventleriyle kapanır", async (t) => {
  const { root } = await fixture(t);
  const runner = async function* () {
    throw new Error("Claude geçici olarak yok");
  };
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    copilotRunner: runner,
    defaultUser: "tuna",
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/copilot",
    payload: { message: "Merhaba", thread_id: "thread-1" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(sseEvents(response), [
    { error: "Claude geçici olarak yok" },
    { done: true, thread_id: "thread-1" },
  ]);
});

test("Claude CLI yokluğu anlaşılır entegrasyon hatası üretir", async () => {
  const chunks = [];
  await assert.rejects(async () => {
    for await (const chunk of runClaude("Merhaba", {
      bin: `/tmp/outpost-missing-claude-${process.pid}`,
      timeoutMs: 1_000,
    })) {
      chunks.push(chunk);
    }
  }, /Claude CLI kurulu değil/);
  assert.deepEqual(chunks, []);
});

test("tmux köprüsü promptu yazar, literal komut ve Enter yollar, dosya eklerini stream eder", async (t) => {
  const { directory } = await fixture(t);
  const calls = [];
  const id = "cp-1234-abcd";
  const outboxDirectory = path.join(directory, "copilot", "outbox");
  const outboxFile = path.join(outboxDirectory, `${id}.md`);
  const doneFile = path.join(outboxDirectory, `${id}.done`);
  let poll = 0;

  const exec = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "capture-pane") return { stdout: "agent hazır\n>\n" };
    return { stdout: "" };
  };
  const sleep = async (milliseconds) => {
    assert.equal(milliseconds, 500);
    poll += 1;
    if (poll === 1) {
      assert.equal(
        await fs.readFile(path.join(directory, "copilot", "inbox", `${id}.md`), "utf8"),
        "TAM PROMPT",
      );
      await fs.writeFile(outboxFile, Buffer.from("Merhaba \xf0\x9f", "binary"));
    } else {
      await fs.appendFile(outboxFile, Buffer.from("\x91\x8b", "binary"));
      await fs.writeFile(doneFile, "", "utf8");
    }
  };
  const bridge = createTmuxBridge({
    exec,
    sleep,
    idFactory: () => id,
    session: "fake-copilot",
  });

  const stream = await bridge("TAM PROMPT", { workspace: { directory } });
  assert.ok(stream);
  const deltas = [];
  for await (const delta of stream) deltas.push(delta);

  await assert.rejects(
    fs.access(path.join(directory, "copilot", "inbox", `${id}.md`)),
    { code: "ENOENT" },
  );
  await assert.rejects(fs.access(outboxFile), { code: "ENOENT" });
  await assert.rejects(fs.access(doneFile), { code: "ENOENT" });
  for (const directoryName of ["copilot", "copilot/inbox", "copilot/outbox"]) {
    assert.equal(
      (await fs.stat(path.join(directory, directoryName))).mode & 0o777,
      0o700,
    );
  }
  assert.equal(deltas.join(""), "Merhaba 👋");
  assert.deepEqual(calls, [
    ["tmux", ["has-session", "-t", "fake-copilot"]],
    ["tmux", ["capture-pane", "-p", "-t", "fake-copilot"]],
    ["tmux", [
      "send-keys",
      "-t",
      "fake-copilot",
      "-l",
      `[copilot ${id}] Soru: copilot/inbox/${id}.md oku; cevabı copilot/outbox/${id}.md dosyasına markdown olarak yaz; bitince copilot/outbox/${id}.done oluştur.`,
    ]],
    ["tmux", ["send-keys", "-t", "fake-copilot", "Enter"]],
    // vim-mode Enter-tekrar korumasının submit kontrolü (pane'de id yok → tek bakışta biter)
    ["tmux", ["capture-pane", "-p", "-t", "fake-copilot"]],
  ]);
});

test("tmux köprüsü meşgul oturumu 2 saniyede bir bekler ve 20 saniye sonunda fallback döndürür", async (t) => {
  const { directory } = await fixture(t);
  const calls = [];
  const warnings = [];
  let clock = 10_000;
  let promptSeen = false;
  const exec = async (_command, args) => {
    calls.push(args);
    if (args[0] === "capture-pane") {
      return { stdout: "eski satır\nesc to interrupt\nsatır 3\nsatır 4\nsatır 5\n>\n" };
    }
    return { stdout: "" };
  };
  const bridge = createTmuxBridge({
    exec,
    now: () => clock,
    sleep: async (milliseconds) => {
      assert.equal(milliseconds, 2_000);
      if (!promptSeen) {
        promptSeen = true;
        assert.equal(
          await fs.readFile(
            path.join(directory, "copilot", "inbox", "cp-busy-0000.md"),
            "utf8",
          ),
          "prompt",
        );
      }
      clock += milliseconds;
    },
    idFactory: () => "cp-busy-0000",
    logger: { warn: (...args) => warnings.push(args) },
  });

  assert.equal(await bridge("prompt", { workspace: { directory } }), null);
  assert.equal(calls.filter((args) => args[0] === "capture-pane").length, 11);
  assert.equal(calls.some((args) => args[0] === "send-keys"), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][1], /headless runner/);
  assert.equal(promptSeen, true);
  await assert.rejects(
    fs.access(path.join(directory, "copilot", "inbox", "cp-busy-0000.md")),
    { code: "ENOENT" },
  );
});

test("tmux session yoksa köprü sessizce fallback döndürür ve journal dizini oluşturmaz", async (t) => {
  const { directory } = await fixture(t);
  const bridge = createTmuxBridge({
    exec: async () => {
      const error = new Error("can't find session");
      error.code = 1;
      throw error;
    },
  });

  assert.equal(await bridge("prompt", { workspace: { directory } }), null);
  await assert.rejects(fs.access(path.join(directory, "copilot")), { code: "ENOENT" });
});

test("tmux outbox 180 saniyede tamamlanmazsa zaman aşımı hatası verir", async (t) => {
  const { directory } = await fixture(t);
  let clock = 0;
  const bridge = createTmuxBridge({
    exec: async (_command, args) => ({
      stdout: args[0] === "capture-pane" ? "hazır" : "",
    }),
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    idFactory: () => "cp-timeout-0000",
  });
  const stream = await bridge("prompt", { workspace: { directory } });

  await assert.rejects(async () => {
    for await (const _delta of stream) { /* tüket */ }
  }, /180 saniyede zaman aşımına uğradı/);
  assert.equal(clock, 180_000);
  for (const suffix of [".md", ".done"]) {
    await assert.rejects(
      fs.access(path.join(directory, "copilot", "outbox", `cp-timeout-0000${suffix}`)),
      { code: "ENOENT" },
    );
  }
});

test("tmux köprüsü eşzamanlı istekleri tek send/wait akışında sıraya alır", async (t) => {
  const { directory } = await fixture(t);
  const ids = ["cp-first", "cp-second"];
  const sends = [];
  const bridge = createTmuxBridge({
    idFactory: () => ids.shift(),
    exec: async (_command, args) => {
      if (args[0] === "capture-pane") return { stdout: "hazır" };
      if (args[0] === "send-keys" && args.includes("-l")) sends.push(args.at(-1));
      return { stdout: "" };
    },
    sleep: async () => {},
  });

  const first = await bridge("birinci", { workspace: { directory } });
  let secondResolved = false;
  const secondPromise = bridge("ikinci", { workspace: { directory } })
    .then((stream) => {
      secondResolved = true;
      return stream;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondResolved, false);
  assert.equal(sends.length, 1);

  await fs.writeFile(path.join(directory, "copilot", "outbox", "cp-first.done"), "", "utf8");
  for await (const _delta of first) { /* tüket */ }
  const second = await secondPromise;
  assert.equal(sends.length, 2);
  await fs.writeFile(path.join(directory, "copilot", "outbox", "cp-second.done"), "", "utf8");
  for await (const _delta of second) { /* tüket */ }
  assert.match(sends[0], /cp-first/);
  assert.match(sends[1], /cp-second/);
});
