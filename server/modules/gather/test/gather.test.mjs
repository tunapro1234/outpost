import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { WorkspaceRegistry } from "../../../lib/config.mjs";
import { serializeMarkdown } from "../../../lib/vault.mjs";
import { temporaryDirectory, writeEntity } from "../../../test-support/helpers.mjs";
import { createApp } from "../../../app.mjs";
import { createRunRecord, listRuns, readRun, writeRun } from "../journal.mjs";
import { readAgentRegistry } from "../registry.mjs";
import {
  GatherRunner,
  assertPublicSiteUrl,
  codexClassify,
  openBrowserSession,
  parseClassifyJson,
} from "../runner.mjs";
import { GatherScheduler, cronMatches } from "../scheduler.mjs";
import { decideStage, listStage } from "../stage.mjs";
import {
  codexPersonSearch,
  expectedGain,
  runDeepeningPolicy,
} from "../person-deepener.mjs";
import { codexText, compileMailContext } from "../../mailer/writer.mjs";

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
    kind: "enrich",
    params: { limit: 2 },
    schedule: "manual",
    enabled: false,
  }]);
});

test("gather browser yapılandırması yoksa anlaşılır hata döner", async (t) => {
  const root = await temporaryDirectory("outpost-browser-missing-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    openBrowserSession({ tokenPath: path.join(root, "missing-token") }),
    /Gather browser is not configured \(missing token:/,
  );
});

test("site URL doğrulaması tüm DNS cevaplarında private ağları ve IP literal hedefleri reddeder", async () => {
  const lookup = async (hostname, options) => {
    assert.equal(hostname, "public.example");
    assert.deepEqual(options, { all: true, verbatim: true });
    return [
      { address: "203.0.113.8", family: 4 },
      { address: "10.2.3.4", family: 4 },
    ];
  };
  await assert.rejects(
    assertPublicSiteUrl("https://public.example", { lookup }),
    /private veya yerel hedefe/,
  );
  for (const url of [
    "http://127.1.2.3",
    "http://169.254.1.1",
    "http://172.31.255.1",
    "http://192.168.1.1",
    "http://[::1]",
    "http://[fd00::1]",
    "http://[fe80::1234]",
  ]) {
    await assert.rejects(assertPublicSiteUrl(url), /private veya yerel hedefe/);
  }
  await assert.rejects(assertPublicSiteUrl("ftp://example.com"), /HTTP\(S\)/);
  assert.equal(
    await assertPublicSiteUrl("example.com", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
    "https://example.com/",
  );
});

test("browser redirect sonrası private final URL sonucunu reddeder", async (t) => {
  const root = await temporaryDirectory("outpost-browser-redirect-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tokenPath = path.join(root, "token");
  await fs.writeFile(tokenPath, "test-token\n", "utf8");
  let pageClosed = false;
  const page = {
    currentUrl: "about:blank",
    async goto() {
      this.currentUrl = "http://127.0.0.1/internal";
    },
    url() { return this.currentUrl; },
    async close() { pageClosed = true; },
  };
  const context = {
    async addInitScript() {},
    async newPage() { return page; },
    async close() {},
  };
  const browser = {
    async newContext() { return context; },
    async close() {},
  };
  const session = await openBrowserSession({
    tokenPath,
    chromium: { connect: async () => browser },
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  await assert.rejects(session.browse("https://example.com"), /private veya yerel hedefe/);
  assert.equal(pageClosed, true);
  await session.close();
});

test("codex classify workspace yerine geçici izole cwd kullanır ve girdiyi stdin'den alır", async (t) => {
  const root = await temporaryDirectory("outpost-classify-test-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "fake-codex.mjs");
  const cwdCapture = path.join(root, "cwd.txt");
  const promptCapture = path.join(root, "prompt.txt");
  await fs.writeFile(bin, `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(cwdCapture)}, process.cwd());
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(promptCapture)}, input);
  process.stdout.write('{"emails":[],"phones":[],"people":[],"summary":"ok"}');
});
`, { mode: 0o700 });
  const workspaceDirectory = path.join(root, "workspace-with-secrets");
  await fs.mkdir(workspaceDirectory);
  await fs.writeFile(path.join(workspaceDirectory, "secret.txt"), "secret", "utf8");

  const result = await codexClassify({
    workspace: { directory: workspaceDirectory },
    agent: { model: "test-model" },
    entity: { meta: { name: "Örnek" } },
    pageData: {
      sourceUrl: "https://example.com/",
      directLinks: [],
      text: "İletişim metni",
    },
    bin,
    timeoutMs: 5_000,
  });
  assert.equal(result.summary, "ok");
  const classifyCwd = await fs.readFile(cwdCapture, "utf8");
  assert.notEqual(classifyCwd, workspaceDirectory);
  assert.match(path.basename(classifyCwd), /^outpost-classify-/);
  assert.match(await fs.readFile(promptCapture, "utf8"), /İletişim metni/);
  await assert.rejects(fs.access(classifyCwd), { code: "ENOENT" });
});

test("codex stdin erken kapanırsa child hatası process'i düşürmeden completion'a bağlanır", async (t) => {
  const root = await temporaryDirectory("outpost-classify-epipe-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "early-exit.mjs");
  await fs.writeFile(bin, "#!/usr/bin/env node\nprocess.stdin.destroy();\nprocess.exit(1);\n", {
    mode: 0o700,
  });
  await assert.rejects(codexClassify({
    agent: { model: "test-model" },
    entity: { meta: { name: "Örnek" } },
    pageData: { sourceUrl: "https://example.com", directLinks: [], text: "x".repeat(30_000) },
    bin,
    timeoutMs: 5_000,
  }), /codex classify (?:I\/O hatası|başarısız)/);
});

test("fast agent tüm Codex exec yollarına service_tier config'ini geçirir", async (t) => {
  const root = await temporaryDirectory("outpost-fast-tier-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const capture = path.join(root, "argv.jsonl");
  const bin = path.join(root, "fake-codex.mjs");
  await fs.writeFile(bin, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(process.argv.includes("--output-schema")
    ? '{"emails":[],"phones":[],"people":[],"summary":"ok"}'
    : '{}');
});
`, { mode: 0o700 });
  const agent = { model: "test-model", params: { service_tier: "fast" } };

  await codexClassify({
    agent,
    entity: { meta: { name: "Örnek" } },
    pageData: { sourceUrl: "https://example.com", directLinks: [], text: "örnek" },
    bin,
    timeoutMs: 5_000,
  });
  await codexPersonSearch({
    agent,
    person: { meta: { name: "Ada" }, body: "" },
    company: null,
    step: "school",
    findings: {},
    bin,
    timeoutMs: 5_000,
  });
  await compileMailContext({
    person: { meta: { name: "Ada" } },
    company: null,
    queueItem: { score: 10, reasons: [] },
    agent,
    workspace: { directory: root },
  }, {
    skillsPath: root,
    runLuna: (prompt, options) => codexText(prompt, { ...options, bin }),
  });

  const calls = (await fs.readFile(capture, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 3);
  for (const args of calls) {
    const tierIndex = args.indexOf('service_tier="fast"');
    assert.ok(tierIndex > 0, `fast tier argümanı eksik: ${JSON.stringify(args)}`);
    assert.equal(args[tierIndex - 1], "-c");
  }
});

test("agent registry kind/source doğrular ve repo şablonlarını okur", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const templateNames = [
    "site-scanner.agent.yaml",
    "company-scout.agent.yaml",
    "people-finder.agent.yaml",
    "person-scout.agent.yaml",
    "person-deepener.agent.yaml",
    "mail-writer.agent.yaml",
  ];
  const templates = await Promise.all(templateNames.map((name) =>
    fs.readFile(new URL(`../${name}`, import.meta.url), "utf8")));
  await fs.writeFile(
    path.join(workspace.directory, "agents.yaml"),
    templates.join("\n"),
    "utf8",
  );
  const agents = await readAgentRegistry(workspace);
  assert.deepEqual(agents.map(({ id, kind, source, enabled, schedule }) => ({
    id,
    kind,
    ...(source ? { source } : {}),
    enabled,
    schedule,
  })), [
    { id: "site-scanner", kind: "enrich", enabled: false, schedule: "manual" },
    { id: "company-scout", kind: "discover-company", enabled: false, schedule: "manual" },
    {
      id: "people-finder",
      kind: "discover-person",
      source: "company",
      enabled: false,
      schedule: "manual",
    },
    {
      id: "person-scout",
      kind: "discover-person",
      source: "standalone",
      enabled: false,
      schedule: "manual",
    },
    { id: "person-deepener", kind: "enrich", enabled: false, schedule: "manual" },
    { id: "mail-writer", kind: "enrich", enabled: false, schedule: "manual" },
  ]);

  await fs.writeFile(
    path.join(workspace.directory, "agents.yaml"),
    templates[1].replace("kind: discover-company", "kind: unknown"),
    "utf8",
  );
  await assert.rejects(readAgentRegistry(workspace), /kind discover-company/);
  await fs.writeFile(
    path.join(workspace.directory, "agents.yaml"),
    templates[0].replace("kind: enrich", "kind:"),
    "utf8",
  );
  await assert.rejects(readAgentRegistry(workspace), /kind discover-company/);
});

test("person deepener okul→yetki→hook sırasını izler, avantajlı okul bütçesini ikiye katlar", async () => {
  const person = { meta: { name: "Ada Aday" } };
  const signals = { advantage_schools: { "Boğaziçi": 100, "İTÜ": 60 } };
  const calls = [];
  const fixture = {
    school: { school: "Boğaziçi Üniversitesi", summary: "okul doğrulandı" },
    authority: { authority: "exec", role: "Teknoloji Direktörü" },
    hooks: { hooks: ["FRC mentoru"], sources: ["https://example.com/news"] },
  };
  const result = await runDeepeningPolicy({
    person,
    importance: 80,
    signals,
    budget: 20,
    threshold: 10,
    source: { search: async (step) => { calls.push(step); return fixture[step]; } },
  });
  assert.deepEqual(calls, ["school", "authority", "hooks"]);
  assert.equal(result.budget, 40);
  assert.equal(result.spent, 28);
  assert.deepEqual(result.findings.hooks, ["FRC mentoru"]);
  assert.equal(expectedGain(80, { school: null, authority: "unknown", hooks: [] }, 4), 76);

  const ordinaryCalls = [];
  const ordinary = await runDeepeningPolicy({
    person,
    importance: 80,
    signals,
    budget: 20,
    threshold: 10,
    source: { search: async (step) => {
      ordinaryCalls.push(step);
      return step === "school" ? { school: "Başka Üniversite" } : { authority: "manager" };
    } },
  });
  assert.deepEqual(ordinaryCalls, ["school", "authority"]);
  assert.equal(ordinary.trace.at(-1).reason, "budget");

  const stopped = await runDeepeningPolicy({
    person,
    importance: 10,
    signals,
    budget: 20,
    threshold: 10,
    source: { search: async () => assert.fail("eşik altında kaynak çağrılmamalı") },
  });
  assert.equal(stopped.completed.length, 0);
  assert.equal(stopped.trace[0].reason, "threshold");
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
    kind: "enrich",
    source_agent: "tarayici",
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
  assert.equal(entity.meta.kind, undefined);
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
  const staged = await listStage(workspace);
  assert.equal(staged.length, 1);
  assert.equal(staged[0].kind, "enrich");
  assert.equal(staged[0].source_agent, "site-scanner");
  assert.deepEqual(await readRun(workspace, run.id), run);
});

test("gather overview canlı runner durumu ile kind bazlı stage/accept sayılarını döndürür", async (t) => {
  const workspace = await fixtureWorkspace(t);
  await fs.writeFile(
    path.join(workspace.directory, "agents.yaml"),
    `- id: site-scanner
  name: Site Scanner
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: browser
  kind: enrich
  params:
    filter: {type: company, has_site: true, has_mail: false}
    limit: 1
  schedule: manual
  enabled: false
- id: company-scout
  name: Company Scout
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: web-search
  kind: discover-company
  schedule: manual
  enabled: false
- id: people-finder
  name: People Finder
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: browser
  kind: discover-person
  source: company
  params: {target: acme}
  schedule: manual
  enabled: true
`,
    "utf8",
  );
  const stageDirectory = path.join(workspace.directory, "stage");
  await fs.mkdir(stageDirectory, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(stageDirectory, "company.md"),
      serializeMarkdown("Yeni şirket.", {
        type: "company",
        name: "Yeni Şirket",
        source_agent: "company-scout",
        kind: "discover-company",
      }),
      "utf8",
    ),
    fs.writeFile(
      path.join(stageDirectory, "legacy.md"),
      serializeMarkdown("Eski öneri.", {
        type: "company",
        name: "Eski Öneri",
        source_agent: "site-scanner",
      }),
      "utf8",
    ),
    fs.writeFile(
      path.join(stageDirectory, "decisions.jsonl"),
      [
        JSON.stringify({ decision: "accept", kind: "discover-person" }),
        JSON.stringify({ decision: "accept" }),
        JSON.stringify({ decision: "reject", kind: "discover-company" }),
        "",
      ].join("\n"),
      "utf8",
    ),
  ]);
  const failedRun = createRunRecord("company-scout", {
    now: () => new Date("2026-07-16T11:00:00.000Z"),
  });
  failedRun.status = "error";
  failedRun.ended = "2026-07-16T11:00:01.000Z";
  failedRun.note = "arama başarısız";
  await writeRun(workspace, failedRun);

  let releaseBrowse;
  let signalBrowseStarted;
  const browseStarted = new Promise((resolve) => { signalBrowseStarted = resolve; });
  const browseGate = new Promise((resolve) => { releaseBrowse = resolve; });
  const runner = new GatherRunner({
    openBrowser: async () => ({
      browse: async () => {
        signalBrowseStarted();
        await browseGate;
        return {
          sourceUrl: "https://example.com/contact",
          text: "",
          directLinks: [],
          webdriverHidden: true,
        };
      },
      close: async () => {},
    }),
    classify: async () => ({
      emails: [],
      phones: [],
      people: [],
      summary: "Yeni alan yok",
    }),
    sleep: async () => {},
  });
  t.after(() => releaseBrowse());
  const app = await createApp({
    workspacesPath: path.dirname(workspace.directory),
    outpostVault: null,
    watch: false,
    gatherRunner: runner,
  });
  t.after(() => app.close());
  const started = await app.inject({
    method: "POST",
    url: "/api/ws/fixture/agents/site-scanner/run",
  });
  assert.equal(started.statusCode, 202);
  await browseStarted;

  const response = await app.inject({ url: "/api/ws/fixture/gather/overview" });
  assert.equal(response.statusCode, 200);
  const overview = response.json();
  assert.deepEqual(overview.counts, {
    "discover-company": { staged: 1, accepted: 0 },
    "discover-person": { staged: 0, accepted: 1 },
    enrich: { staged: 1, accepted: 1 },
  });
  const byId = Object.fromEntries(overview.agents.map((agent) => [agent.id, agent]));
  assert.equal(byId["site-scanner"].status, "running");
  assert.equal(byId["site-scanner"].currentTask, "example.com taranıyor");
  assert.equal(byId["site-scanner"].stagedCount, 1);
  assert.equal(byId["site-scanner"].lastRunSummary, "Run in progress");
  assert.equal(byId["company-scout"].status, "error");
  assert.equal(byId["company-scout"].currentTask, null);
  assert.equal(byId["company-scout"].lastRunAt, "2026-07-16T11:00:00.000Z");
  assert.equal(byId["company-scout"].lastRunSummary, "Failed: arama başarısız");
  assert.equal(byId["company-scout"].stagedCount, 1);
  assert.equal(byId["people-finder"].source, "company");
  assert.equal(byId["people-finder"].status, "idle");

  releaseBrowse();
  await runner.active.get(runner.lockKey(app.workspaceRegistry.get("fixture"), "site-scanner"));
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

test("PATCH agent kimliği doğrular, alanları merge edip agents.yaml'a atomik yazar", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const agentsPath = path.join(workspace.directory, "agents.yaml");
  await fs.writeFile(agentsPath, `version: 1
agents:
  - id: site-scanner
    name: Site Scanner
    zone: gathering
    model: gpt-5.6-luna
    task: scrape-classify
    integration: browser
    params:
      filter: {type: company}
      limit: 5
    schedule: manual
    enabled: false
    custom: korunacak
  - id: diger
    name: Diğer
    zone: gathering
    model: gpt-5.6-luna
    task: scrape-classify
    integration: browser
    schedule: manual
    enabled: false
`, "utf8");
  const app = await createApp({
    workspacesPath: path.dirname(workspace.directory),
    outpostVault: null,
    watch: false,
    defaultUser: null,
  });
  t.after(() => app.close());
  const url = "/api/ws/fixture/agents/site-scanner";

  assert.equal((await app.inject({ method: "PATCH", url, payload: { enabled: true } })).statusCode, 401);
  assert.equal((await app.inject({
    method: "PATCH",
    url,
    headers: { "x-remote-user": "" },
    payload: { enabled: true },
  })).statusCode, 401);
  for (const payload of [
    { schedule: "0 0 1 1" },
    { schedule: "61 * * * *" },
    { schedule: "1,bad * * * *" },
    { params: { limit: 0 } },
    { params: { limit: 21 } },
    { params: { limit: 1.5 } },
  ]) {
    const response = await app.inject({
      method: "PATCH",
      url,
      headers: { "x-remote-user": "tuna" },
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(response.json()));
  }

  const updated = await app.inject({
    method: "PATCH",
    url,
    headers: { "x-remote-user": "tuna" },
    payload: {
      schedule: "3 4 * * *",
      enabled: true,
      params: { limit: 7, service_tier: "fast" },
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().schedule, "3 4 * * *");
  assert.equal(updated.json().enabled, true);
  assert.deepEqual(updated.json().params, {
    filter: { type: "company" },
    limit: 7,
    service_tier: "fast",
  });

  const document = yaml.load(await fs.readFile(agentsPath, "utf8"));
  assert.equal(document.version, 1);
  assert.equal(document.agents[0].custom, "korunacak");
  assert.deepEqual(document.agents[0].params, updated.json().params);
  assert.equal(document.agents[1].enabled, false);
  assert.ok(!(await fs.readdir(workspace.directory)).some((name) => name.endsWith(".tmp")));
});

test("PATCH agent OUTPOST_DEFAULT_USER eşdeğeri defaultUser ile çalışır", async (t) => {
  const workspace = await fixtureWorkspace(t);
  await fs.writeFile(path.join(workspace.directory, "agents.yaml"), `- id: site-scanner
  name: Site Scanner
  zone: gathering
  model: gpt-5.6-luna
  task: scrape-classify
  integration: browser
  schedule: manual
  enabled: false
`, "utf8");
  const app = await createApp({
    workspacesPath: path.dirname(workspace.directory),
    outpostVault: null,
    watch: false,
    defaultUser: "tuna",
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: "PATCH",
    url: "/api/ws/fixture/agents/site-scanner",
    payload: { enabled: true },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().enabled, true);
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
