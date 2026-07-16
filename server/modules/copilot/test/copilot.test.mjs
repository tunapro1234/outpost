import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { WorkspaceRegistry } from "../../../lib/config.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../../../test-support/helpers.mjs";
import { createRunRecord, writeRun } from "../../gather/journal.mjs";
import { buildCopilotPrompt, workspaceSummary } from "../context.mjs";

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

test("copilot owner gate header yokluğunu local tuna sayar ve diğer kullanıcıyı engeller", async (t) => {
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
