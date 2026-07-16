import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { WorkspaceRegistry } from "../../../lib/config.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../../../test-support/helpers.mjs";
import { createApp } from "../../../app.mjs";
import { createRunRecord, listRuns, readRun, writeRun } from "../journal.mjs";
import { readAgentRegistry } from "../registry.mjs";
import { GatherRunner, parseClassifyJson } from "../runner.mjs";
import { GatherScheduler, cronMatches } from "../scheduler.mjs";
import { decideStage, listStage } from "../stage.mjs";

async function fixtureWorkspace(t) {
  const root = await temporaryDirectory("outpost-gather-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  const vault = path.join(directory, "vault");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "config.yaml"), "name: Fixture\n", "utf8");
  await writeEntity(
    vault,
    "companies",
    "ornek-sirket",
    serializeMarkdown("Mevcut gövde.\n", {
      type: "company",
      name: "Örnek Şirket",
      site: "https://example.com",
      mail: "",
      ozel_alan: "koru",
    }),
  );
  const registry = await WorkspaceRegistry.load({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
  });
  t.after(() => registry.close());
  return registry.get("fixture");
}

test("agent registry YAML listesini parse eder ve eksik dosyada boş döner", async (t) => {
  const workspace = await fixtureWorkspace(t);
  assert.deepEqual(await readAgentRegistry(workspace), []);
  await fs.writeFile(
    path.join(workspace.directory, "agents.yaml"),
    `- id: tarayici
  name: Tarayıcı
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: browser
  params:
    limit: 2
  schedule: manual
`,
    "utf8",
  );
  assert.deepEqual(await readAgentRegistry(workspace), [{
    id: "tarayici",
    name: "Tarayıcı",
    zone: "gathering",
    model: "gpt-5.6-luna",
    task: "scrape-classify",
    integration: "browser",
    params: { limit: 2 },
    schedule: "manual",
    enabled: false,
  }]);
});

test("run journal gerçek ISO zamanlı kaydı yazar, listeler ve id ile okur", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const now = () => new Date("2026-07-16T12:34:56.789Z");
  const run = createRunRecord("tarayici", { now });
  run.status = "ok";
  run.ended = "2026-07-16T12:35:00.000Z";
  run.items_in = 2;
  await writeRun(workspace, run);
  assert.deepEqual(await readRun(workspace, run.id), run);
  assert.deepEqual(await listRuns(workspace, { agent: "tarayici" }), [run]);
});

test("stage accept mevcut vault notunu merge eder ve karar kaydı yazar", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const stageDirectory = path.join(workspace.directory, "stage");
  await fs.mkdir(stageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(stageDirectory, "ornek.md"),
    serializeMarkdown("Kaynak özeti.\n", {
      type: "company",
      name: "Örnek Şirket",
      entity_id: "ornek-sirket",
      source_agent: "tarayici",
      gathered_at: "2026-07-16T12:00:00.000Z",
      gather_summary: "Yeni iletişim bulundu",
      mail: "hello@example.com",
      phone: "+90 212 000 00 00",
    }),
    "utf8",
  );
  assert.deepEqual(await listStage(workspace), [{
    file: "ornek.md",
    entity_hint: "ornek-sirket",
    summary: "Yeni iletişim bulundu",
    fields: {
      mail: "hello@example.com",
      phone: "+90 212 000 00 00",
    },
  }]);

  let committed = null;
  const result = await decideStage(
    workspace,
    { file: "ornek.md", decision: "accept", note: "doğrulandı" },
    { commit: async (_workspace, filePath, name) => { committed = { filePath, name }; } },
  );
  assert.deepEqual(result, { ok: true, decision: "accept", entity_id: "ornek-sirket" });
  assert.equal(committed.name, "Örnek Şirket");
  const entity = workspace.index.entities.get("ornek-sirket");
  assert.equal(entity.meta.mail, "hello@example.com");
  assert.equal(entity.meta.ozel_alan, "koru");
  assert.match(entity.body, /Gathering kabulü/);
  assert.match(
    await fs.readFile(path.join(stageDirectory, "decisions.jsonl"), "utf8"),
    /"decision":"accept"/,
  );
  await assert.rejects(fs.access(path.join(stageDirectory, "ornek.md")), { code: "ENOENT" });
});

test("runner sahte browser/classify ile stage ve journal üretir; parser structured JSON okur", async (t) => {
  const workspace = await fixtureWorkspace(t);
  await fs.writeFile(
    path.join(workspace.directory, "agents.yaml"),
    `- id: site-scanner
  name: Site Scanner
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: browser
  params:
    filter: {type: company, has_site: true, has_mail: false}
    limit: 1
  schedule: manual
  enabled: false
`,
    "utf8",
  );
  const classification = parseClassifyJson(
    '```json\n{"emails":["hello@example.com"],"phones":[],"people":[],"summary":"İletişim bulundu"}\n```',
  );
  let classifyCalls = 0;
  const runner = new GatherRunner({
    openBrowser: async () => ({
      browse: async () => ({
        sourceUrl: "https://example.com/contact",
        text: "hello@example.com",
        directLinks: ["mailto:hello@example.com"],
        webdriverHidden: true,
      }),
      close: async () => {},
    }),
    classify: async () => {
      classifyCalls += 1;
      return classification;
    },
    sleep: async () => {},
  });
  const run = await runner.run(workspace, "site-scanner");
  assert.equal(classifyCalls, 1);
  assert.equal(run.status, "ok");
  assert.equal(run.items_in, 1);
  assert.equal(run.items_out, 1);
  assert.equal(run.staged, 1);
  assert.match(run.log_tail, /webdriver=hidden/);
  assert.equal((await listStage(workspace)).length, 1);
  assert.deepEqual(await readRun(workspace, run.id), run);
});

test("gather API agents/run/runs/stage sözleşmesini ws scope altında sunar", async (t) => {
  const workspace = await fixtureWorkspace(t);
  await fs.writeFile(
    path.join(workspace.directory, "agents.yaml"),
    `- id: site-scanner
  name: Site Scanner
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: browser
  params:
    filter: {type: company, has_site: true, has_mail: false}
    limit: 1
  schedule: manual
  enabled: false
`,
    "utf8",
  );
  const runner = new GatherRunner({
    openBrowser: async () => ({
      browse: async () => ({
        sourceUrl: "https://example.com/contact",
        text: "hello@example.com",
        directLinks: ["mailto:hello@example.com"],
        webdriverHidden: true,
      }),
      close: async () => {},
    }),
    classify: async () => ({
      emails: ["hello@example.com"],
      phones: [],
      people: [],
      summary: "İletişim bulundu",
    }),
    sleep: async () => {},
  });
  const root = path.dirname(workspace.directory);
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    gatherRunner: runner,
  });
  t.after(() => app.close());

  const agents = (await app.inject({ url: "/api/ws/fixture/agents" })).json();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].enabled, false);
  assert.equal(agents[0].last_run, null);
  const started = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/agents/site-scanner/run",
  });
  assert.equal(started.statusCode, 202);
  const runId = started.json().id;
  await runner.active.get(runner.lockKey(app.workspaceRegistry.get("fixture"), "site-scanner"));
  const detail = await app.inject({ url: `/api/ws/fixture/runs/${runId}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().status, "ok");
  assert.equal((await app.inject({
    url: "/api/ws/fixture/runs?agent=site-scanner",
  })).json().length, 1);
  assert.equal((await app.inject({ url: "/api/ws/fixture/stage" })).json().length, 1);
});

test("cron-lite yalnızca enabled cron agentını dakika başına bir kez tetikler", async (t) => {
  const date = new Date("2026-07-16T10:10:00.000Z");
  assert.equal(cronMatches("*/5 * * * *", date), true);
  assert.equal(cronMatches("3 * * * *", date), false);
  const directory = await temporaryDirectory("outpost-cron-");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const record = (id, schedule, enabled) => `- id: ${id}
  name: ${id}
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: browser
  schedule: '${schedule}'
  enabled: ${enabled}
`;
  await fs.writeFile(
    path.join(directory, "agents.yaml"),
    record("enabled-cron", "*/5 * * * *", true) +
      record("disabled-cron", "*/5 * * * *", false) +
      record("enabled-manual", "manual", true),
    "utf8",
  );
  const workspace = { id: "fixture", directory };
  const calls = [];
  const scheduler = new GatherScheduler(
    { workspaces: new Map([["fixture", workspace]]) },
    { start: async (_workspace, id) => {
      calls.push(id);
      return { promise: Promise.resolve() };
    } },
    { now: () => date },
  );
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(calls, ["enabled-cron"]);
});
