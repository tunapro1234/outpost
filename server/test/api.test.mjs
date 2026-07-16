import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { createApp } from "../app.mjs";
import { temporaryDirectory, writeEntity } from "../test-support/helpers.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_VAULT = path.resolve(TEST_DIRECTORY, "../../example-vault");

test("graph endpoint type/status/minScore/q filtrelerini ve mock şeklini uygular", async (t) => {
  const app = await createApp({ vaultPath: EXAMPLE_VAULT, watch: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/graph?types=company,institution&statuses=gonderildi,randevu&minScore=30&q=%C4%B1",
  });
  assert.equal(response.statusCode, 200);
  const graph = response.json();
  assert.deepEqual(
    graph.nodes.map((node) => node.id).sort(),
    ["kivilcim-robotik-atolyesi", "pusula-bilim-evi"],
  );
  assert.ok(graph.nodes.every((node) =>
    ["id", "name", "type", "subtype", "status", "score", "degree"]
      .every((key) => Object.hasOwn(node, key))));
  assert.ok(graph.edges.every((edge) =>
    graph.nodes.some((node) => node.id === edge.source) &&
    graph.nodes.some((node) => node.id === edge.target)));
});

test("entities, stats, detail ve health endpointleri sözleşme şeklini döndürür", async (t) => {
  const app = await createApp({ vaultPath: EXAMPLE_VAULT, watch: false });
  t.after(() => app.close());

  const health = (await app.inject({ url: "/healthz" })).json();
  assert.deepEqual(health, { ok: true, vault: EXAMPLE_VAULT, entities: 13 });

  const entities = (await app.inject({
    url: "/api/entities?type=person&sort=score&order=desc",
  })).json();
  assert.equal(entities.length, 3);
  assert.deepEqual(Object.keys(entities[0]), [
    "id", "name", "type", "subtype", "role", "closeness", "hook", "mail_source",
    "status", "score", "city", "mail", "degree",
    "mail_count", "last_mail_date", "last_mail_direction", "last_mail_from",
  ]);
  assert.ok(entities[0].score >= entities[1].score);

  const detail = (await app.inject({ url: "/api/entities/arda-gokcizgi" })).json();
  assert.deepEqual(Object.keys(detail), ["id", "meta", "body", "relations", "unresolved"]);
  assert.ok(detail.relations.some((relation) => relation.direction === "out"));

  const stats = (await app.inject({ url: "/api/stats" })).json();
  assert.equal(stats.total, 13);
  assert.deepEqual(stats.byType, {
    person: 3,
    company: 3,
    institution: 2,
    school: 3,
    channel: 2,
  });
  assert.ok(stats.edgeCount > 0);
});

test("facets endpoint metadata sayaçlarını ve degree özetini indeksten üretir", async (t) => {
  const app = await createApp({ vaultPath: EXAMPLE_VAULT, watch: false });
  t.after(() => app.close());

  const response = await app.inject({ url: "/api/facets" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    subtypes: {
      person: { kurucu: 1, mudur: 1, egitmen: 1 },
      company: { atolye: 2, tedarikci: 1 },
      institution: { vakif: 1, "bilim-merkezi": 1 },
      school: { kolej: 1, lise: 1, universite: 1 },
      channel: { fuar: 1, topluluk: 1 },
    },
    statuses: {
      arastirildi: 2,
      cevap: 2,
      aday: 2,
      gonderildi: 1,
      "onay-bekliyor": 1,
      pas: 1,
      taslak: 1,
      randevu: 1,
    },
    cities: { İstanbul: 4, Ankara: 3, İzmir: 4, Bursa: 1, Eskişehir: 1 },
    mail_sources: { pattern: 1, yayimlanmis: 2, info: 3 },
    degree: { max: 6, p99: 6 },
  });
});

test("mails endpoint Mailler bölümünü parse eder ve null tarihler sonda kalır", async (t) => {
  const vault = await temporaryDirectory();
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  await writeEntity(
    vault,
    "people",
    "posta-kisisi",
    `---
type: person
name: Posta Kişisi
---
## Mailler
- 2026-07-14 → giden: Tanışma mesajı
- 2026-07-16 <- gelen: Olumlu yanıt
biçimsiz ama korunacak
- 2026-07-15 -> giden: Takip mesajı

## Notlar
- 2026-12-31 → giden: Bu mail bölümünde değil
`,
  );
  await writeEntity(
    vault,
    "companies",
    "posta-sirketi",
    `---
type: company
name: Posta Şirketi
---
## Mailler
- 2026-12-30 → giden: Kişi olmadığı için görünmez
`,
  );
  const app = await createApp({ vaultPath: vault, watch: false });
  t.after(() => app.close());

  const response = await app.inject({ url: "/api/mails" });
  assert.equal(response.statusCode, 200);
  const mails = response.json();
  assert.equal(mails.length, 4);
  assert.ok(mails.every((mail) => mail.source === "vault"));
  assert.deepEqual(mails.map((mail) => ({
    person_id: mail.person_id,
    person_name: mail.person_name,
    date: mail.date,
    direction: mail.direction,
    summary: mail.summary,
    raw: mail.raw,
  })), [
    {
      person_id: "posta-kisisi",
      person_name: "Posta Kişisi",
      date: "2026-07-16",
      direction: "in",
      summary: "Olumlu yanıt",
      raw: "- 2026-07-16 <- gelen: Olumlu yanıt",
    },
    {
      person_id: "posta-kisisi",
      person_name: "Posta Kişisi",
      date: "2026-07-15",
      direction: "out",
      summary: "Takip mesajı",
      raw: "- 2026-07-15 -> giden: Takip mesajı",
    },
    {
      person_id: "posta-kisisi",
      person_name: "Posta Kişisi",
      date: "2026-07-14",
      direction: "out",
      summary: "Tanışma mesajı",
      raw: "- 2026-07-14 → giden: Tanışma mesajı",
    },
    {
      person_id: "posta-kisisi",
      person_name: "Posta Kişisi",
      date: null,
      direction: "unknown",
      summary: "biçimsiz ama korunacak",
      raw: "biçimsiz ama korunacak",
    },
  ]);
});

test("PATCH partial merge bilinmeyen alanı, alan sırasını ve body'yi korur", async (t) => {
  const vault = await temporaryDirectory();
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const filePath = await writeEntity(
    vault,
    "companies",
    "sira-deneyi",
    `---
type: company
name: Sıra Deneyi
ozel_alan: sakla
status: aday
score: 8
---
Eski gövde.
`,
  );
  const app = await createApp({ vaultPath: vault, watch: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: "PATCH",
    url: "/api/entities/sira-deneyi",
    payload: {
      meta: { status: "cevap", score: null, yeni_alan: "sona" },
      body: "Yeni gövde.\n\n## Notlar\nAynen kalır.\n",
    },
  });
  assert.equal(response.statusCode, 200);
  const detail = response.json();
  assert.equal(detail.meta.ozel_alan, "sakla");
  assert.equal(detail.meta.status, "cevap");
  assert.equal(detail.meta.yeni_alan, "sona");
  assert.equal(Object.hasOwn(detail.meta, "score"), false);
  assert.equal(detail.body, "Yeni gövde.\n\n## Notlar\nAynen kalır.\n");

  const raw = await fs.readFile(filePath, "utf8");
  const reparsed = matter(raw);
  assert.equal(reparsed.data.ozel_alan, "sakla");
  assert.ok(raw.indexOf("ozel_alan:") < raw.indexOf("status:"));
  assert.ok(raw.indexOf("status:") < raw.indexOf("yeni_alan:"));
});

test("POST slug çakışmasına -2 ekler, DELETE .trash'a taşır", async (t) => {
  const vault = await temporaryDirectory();
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const app = await createApp({ vaultPath: vault, watch: false });
  t.after(() => app.close());

  for (const expectedId of ["bogazici-universitesi", "bogazici-universitesi-2"]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: { type: "school", name: "Boğaziçi Üniversitesi", meta: { x_extra: 1 } },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().id, expectedId);
  }

  const deleted = await app.inject({
    method: "DELETE",
    url: "/api/entities/bogazici-universitesi",
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json(), { ok: true });
  await fs.access(path.join(vault, ".trash", "bogazici-universitesi.md"));
  assert.equal(
    (await app.inject({ url: "/api/entities/bogazici-universitesi" })).statusCode,
    404,
  );
});

test("POST eşzamanlı dosya EEXIST yarışında sınırlı suffix retry yapar", async (t) => {
  const vault = await temporaryDirectory();
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const app = await createApp({ vaultPath: vault, watch: false });
  t.after(() => app.close());

  await writeEntity(
    vault,
    "companies",
    "race-entity",
    "---\ntype: company\nname: Yarıştaki Dosya\n---\n",
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/entities",
    payload: { type: "company", name: "Race Entity" },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().id, "race-entity-2");
});

test("vault index ve PATCH/create symlink ile canonical kök dışına çıkmayı reddeder", async (t) => {
  const vault = await temporaryDirectory("outpost-vault-symlink-");
  const outside = await temporaryDirectory("outpost-vault-outside-");
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const outsideFile = path.join(outside, "outside.md");
  await fs.writeFile(
    outsideFile,
    "---\ntype: company\nname: Dışarıdaki\n---\nDış içerik.\n",
    "utf8",
  );
  const indexedFile = await writeEntity(
    vault,
    "people",
    "indexed",
    "---\ntype: person\nname: Indexed\n---\nİç içerik.\n",
  );
  await fs.mkdir(path.join(vault, "companies"), { recursive: true });
  await fs.symlink(outsideFile, path.join(vault, "companies", "linked.md"));

  const app = await createApp({ vaultPath: vault, watch: false });
  t.after(() => app.close());
  assert.equal(app.vaultIndex.entities.has("linked"), false);

  await fs.unlink(indexedFile);
  await fs.symlink(outsideFile, indexedFile);
  const patchResponse = await app.inject({
    method: "PATCH",
    url: "/api/entities/indexed",
    payload: { body: "Ezilmemeli" },
  });
  assert.equal(patchResponse.statusCode, 400);
  assert.match(patchResponse.json().error, /symlink/);
  assert.match(await fs.readFile(outsideFile, "utf8"), /Dış içerik/);

  await fs.rm(path.join(vault, "schools"), { recursive: true, force: true });
  await fs.symlink(outside, path.join(vault, "schools"), "dir");
  const createResponse = await app.inject({
    method: "POST",
    url: "/api/entities",
    payload: { type: "school", name: "Kök Dışı" },
  });
  assert.equal(createResponse.statusCode, 400);
  assert.match(createResponse.json().error, /(?:symlink dizinleri|canonical kök dışında)/);
  await assert.rejects(fs.access(path.join(outside, "kok-disi.md")), { code: "ENOENT" });
});

test("chokidar değişikliklerini 150ms batch ile tek graph rebuild'de indekse alır", async (t) => {
  const vault = await temporaryDirectory();
  await fs.mkdir(path.join(vault, "people"), { recursive: true });
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const app = await createApp({ vaultPath: vault, watch: true, schedule: false });
  t.after(() => app.close());
  const originalRebuild = app.vaultIndex.rebuildGraph.bind(app.vaultIndex);
  let rebuilds = 0;
  app.vaultIndex.rebuildGraph = () => {
    rebuilds += 1;
    return originalRebuild();
  };

  await Promise.all([
    writeEntity(
      vault,
      "people",
      "izlenen-kisi",
      "---\ntype: person\nname: İzlenen Kişi\n---\nWatcher gövdesi.\n",
    ),
    writeEntity(
      vault,
      "people",
      "ikinci-kisi",
      "---\ntype: person\nname: İkinci Kişi\n---\nWatcher gövdesi.\n",
    ),
  ]);
  let found = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [first, second] = await Promise.all([
      app.inject({ url: "/api/entities/izlenen-kisi" }),
      app.inject({ url: "/api/entities/ikinci-kisi" }),
    ]);
    if (first.statusCode === 200 && second.statusCode === 200) {
      found = true;
      break;
    }
  }
  assert.equal(found, true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(rebuilds, 1);
});

test("statik dosya servisi webDist dışına çıkan symlink hedefini 404 yapar", async (t) => {
  const vault = await temporaryDirectory("outpost-static-vault-");
  const webDist = await temporaryDirectory("outpost-static-dist-");
  const outside = await temporaryDirectory("outpost-static-outside-");
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  t.after(() => fs.rm(webDist, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(webDist, "index.html"), "<h1>Outpost</h1>", "utf8");
  await fs.writeFile(path.join(outside, "secret.txt"), "çok gizli", "utf8");
  await fs.symlink(path.join(outside, "secret.txt"), path.join(webDist, "secret.txt"));
  const app = await createApp({ vaultPath: vault, webDist, watch: false });
  t.after(() => app.close());

  const response = await app.inject({ url: "/secret.txt" });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "Dosya bulunamadı" });
  assert.doesNotMatch(response.body, /çok gizli/);
});

test("API hataları ortak JSON şeklini kullanır", async (t) => {
  const app = await createApp({ vaultPath: EXAMPLE_VAULT, watch: false });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/entities",
    headers: { "content-type": "application/json" },
    payload: '{"bozuk":',
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(Object.keys(response.json()), ["error"]);
});
