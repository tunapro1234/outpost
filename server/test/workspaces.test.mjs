import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../app.mjs";
import { WorkspaceRegistry } from "../lib/config.mjs";
import { importProbot } from "../modules/reach/import-probot.mjs";
import { temporaryDirectory, writeEntity } from "../test-support/helpers.mjs";

async function writeWorkspace(root, id, name, entityId) {
  const directory = path.join(root, id);
  const vault = path.join(directory, "vault");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "config.yaml"), `name: ${name}\n`, "utf8");
  await writeEntity(
    vault,
    "companies",
    entityId,
    `---\ntype: company\nname: ${name} Şirketi\n---\n`,
  );
  return { directory, vault };
}

test("workspace taraması scoped API'leri ve legacy default alias'ını ayırır", async (t) => {
  const root = await temporaryDirectory("outpost-workspaces-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "config.yaml"), "default_workspace: beta\n", "utf8");
  await writeWorkspace(root, "alpha", "Alpha", "alpha-sirketi");
  await writeWorkspace(root, "beta", "Beta", "beta-sirketi");

  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());

  assert.deepEqual((await app.inject({ url: "/api/workspaces" })).json(), [
    { id: "alpha", name: "Alpha", entities: 1, default: false },
    { id: "beta", name: "Beta", entities: 1, default: true },
  ]);
  const alpha = (await app.inject({ url: "/api/ws/alpha/entities" })).json();
  assert.deepEqual(alpha.map((entity) => entity.id), ["alpha-sirketi"]);
  const legacy = (await app.inject({ url: "/api/graph" })).json();
  assert.deepEqual(legacy.nodes.map((node) => node.id), ["beta-sirketi"]);
  assert.equal((await app.inject({ url: "/api/ws/yok/entities" })).statusCode, 404);
});

test("boş workspace kökü example-vault kopyasından demo workspace tohumlar", async (t) => {
  const root = await temporaryDirectory("outpost-workspace-seed-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const seeded = [];
  const registry = await WorkspaceRegistry.load({
    workspacesPath: root,
    outpostVault: null,
    onSeed: (record) => seeded.push(record),
    watch: false,
  });

  assert.deepEqual(registry.list(), [
    { id: "demo", name: "Demo", entities: 13, default: true },
  ]);
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].id, "demo");
  assert.equal(
    await fs.readFile(path.join(root, "demo", "config.yaml"), "utf8"),
    "name: Demo\n",
  );
  assert.match(
    await fs.readFile(path.join(root, "demo", "vault", "README.md"), "utf8"),
    /Outpost örnek vault/,
  );

  await registry.close();
  const reopened = await WorkspaceRegistry.load({
    workspacesPath: root,
    outpostVault: null,
    onSeed: (record) => seeded.push(record),
    watch: false,
  });
  t.after(() => reopened.close());
  assert.equal(seeded.length, 1);
  assert.equal(reopened.getDefault().id, "demo");
});

test("scoped entities listesi frontmatter liste alanlarını ve null varsayılanlarını döndürür", async (t) => {
  const root = await temporaryDirectory("outpost-entity-list-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "config.yaml"), "default_workspace: probot\n", "utf8");
  const { vault } = await writeWorkspace(root, "probot", "Probot", "hedef");
  await writeEntity(
    vault,
    "people",
    "alanli-kisi",
    `---
type: person
name: Alanlı Kişi
subtype: kurucu
role: kurucu ortak
closeness: 4
hook: Robotik mentorluk programını büyütüyor.
mail_source: yayimlanmis
---
`,
  );
  await writeEntity(
    vault,
    "people",
    "bos-kisi",
    "---\ntype: person\nname: Boş Kişi\n---\n",
  );

  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());
  const people = (await app.inject({
    url: "/api/ws/probot/entities?type=person&sort=name&order=asc",
  })).json();

  assert.deepEqual(
    Object.fromEntries(
      ["subtype", "role", "closeness", "hook", "mail_source"]
        .map((key) => [key, people[0][key]]),
    ),
    {
      subtype: "kurucu",
      role: "kurucu ortak",
      closeness: 4,
      hook: "Robotik mentorluk programını büyütüyor.",
      mail_source: "yayimlanmis",
    },
  );
  assert.deepEqual(
    Object.fromEntries(
      ["subtype", "role", "closeness", "hook", "mail_source"]
        .map((key) => [key, people[1][key]]),
    ),
    { subtype: null, role: null, closeness: null, hook: null, mail_source: null },
  );
});

test("OUTPOST_VAULT boş registry'yi Probot olarak kurar, stale yol workspace'i ezmez", async (t) => {
  const root = await temporaryDirectory("outpost-workspace-env-");
  const externalVault = await temporaryDirectory("outpost-external-vault-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(externalVault, { recursive: true, force: true }));
  await writeEntity(
    externalVault,
    "companies",
    "env-sirketi",
    "---\ntype: company\nname: Env Şirketi\n---\n",
  );

  const fallback = await createApp({
    workspacesPath: root,
    outpostVault: externalVault,
    watch: false,
  });
  assert.deepEqual((await fallback.inject({ url: "/api/workspaces" })).json(), [
    { id: "probot", name: "Probot", entities: 1, default: true },
  ]);
  await fallback.close();
  assert.equal(
    await fs.readFile(path.join(root, "probot", "config.yaml"), "utf8"),
    "name: Probot\n",
  );

  const localVault = path.join(root, "probot", "vault");
  await writeEntity(
    localVault,
    "companies",
    "yerel-sirket",
    "---\ntype: company\nname: Yerel Şirket\n---\n",
  );
  const stale = await createApp({
    workspacesPath: root,
    outpostVault: path.join(root, "artık-yok"),
    watch: false,
  });
  t.after(() => stale.close());
  assert.deepEqual(
    (await stale.inject({ url: "/api/entities" })).json().map((entity) => entity.id),
    ["yerel-sirket"],
  );
});

test("mail log scoped mails, entity türevleri ve graph mail_count üretir", async (t) => {
  const root = await temporaryDirectory("outpost-reach-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { directory, vault } = await writeWorkspace(root, "probot", "Probot", "hedef");
  await writeEntity(
    vault,
    "people",
    "ayse",
    `---
type: person
name: Ayşe
mail: ayse@example.com
---
## Mailler
- 2026-07-13 → giden: Vault mesajı
`,
  );
  const log = [
    {
      id: "mail-1",
      entity_id: "ayse",
      person_id: "ayse",
      direction: "out",
      date: "2026-07-14",
      from: "tuna@probot.studio",
      to: "ayse@example.com",
      subject: "Tanışma",
      summary: "İlk temas",
      source: "import",
    },
    {
      id: "mail-2",
      entity_id: "ayse",
      person_id: "ayse",
      direction: "in",
      date: "2026-07-15",
      from: "ayse@example.com",
      to: "tuna@probot.studio",
      subject: "Re: Tanışma",
      summary: "Olumlu cevap",
      source: "manual",
    },
  ];
  await fs.mkdir(path.join(directory, "mails"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "mails", "log.jsonl"),
    `${log.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );

  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());
  const mails = (await app.inject({ url: "/api/ws/probot/mails" })).json();
  assert.equal(mails.length, 3);
  assert.deepEqual(new Set(mails.map((mail) => mail.source)), new Set(["import", "manual", "vault"]));

  const ayse = (await app.inject({ url: "/api/ws/probot/entities?type=person" })).json()[0];
  assert.equal(ayse.mail_count, 2);
  assert.equal(ayse.last_mail_date, "2026-07-15");
  assert.equal(ayse.last_mail_direction, "in");
  assert.equal(ayse.last_mail_from, "ayse@example.com");
  const node = (await app.inject({ url: "/api/ws/probot/graph?types=person" })).json().nodes[0];
  assert.equal(node.mail_count, 2);
});

test("Probot importu gerçek gönderimleri, cevapları ve vault trafiğini dedup eder", async (t) => {
  const root = await temporaryDirectory("outpost-import-reach-");
  const outreach = await temporaryDirectory("outpost-outreach-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outreach, { recursive: true, force: true }));
  const { vault } = await writeWorkspace(root, "probot", "Probot", "ornek-kurum");
  await writeEntity(
    vault,
    "companies",
    "ornek-kurum",
    `---
type: company
name: Örnek Kurum
---
## Mailler
- 2026-07-12 → giden: Vault takibi
`,
  );
  await writeEntity(
    vault,
    "people",
    "ornek-kisi",
    "---\ntype: person\nname: Örnek Kişi\nmail: kisi@example.com\n---\n",
  );
  await fs.writeFile(
    path.join(outreach, "gonderilen.md"),
    `## Kayıt
- tarih: 2026-07-11
- kurum: Örnek Kurum
- alıcı: kisi@example.com
- konu: Tanışma
- durum: gönderildi

## Kayıt
- tarih: 2026-07-11
- kurum: Örnek Kurum
- alıcı: kisi@example.com
- konu: Tanışma
- durum: gönderildi
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outreach, "cevaplar.md"),
    `<!--
## Kayıt
- tarih: 2026-07-13
- kurum: Yorumdaki Kurum
- gönderen: yorum@example.com
- konu: Atlanmalı
-->
`,
    "utf8",
  );

  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());
  const report = await importProbot({
    workspace: app.workspaceRegistry.get("probot"),
    outreachPath: outreach,
  });
  assert.equal(report.records, 2);
  assert.equal(report.new_records, 2);
  assert.equal(report.matched_entities, 1);
  assert.deepEqual(report.by_source, { sent: 2, replies: 0, vault: 1 });
  assert.equal(
    (await fs.readFile(path.join(root, "probot", "mails", "log.jsonl"), "utf8"))
      .trim().split("\n").length,
    2,
  );
});
