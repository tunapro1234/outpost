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
    "id", "name", "type", "subtype", "status", "score", "city", "mail", "degree",
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

test("chokidar değişiklikleri tam tarama olmadan indekse alır", async (t) => {
  const vault = await temporaryDirectory();
  await fs.mkdir(path.join(vault, "people"), { recursive: true });
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const app = await createApp({ vaultPath: vault, watch: true });
  t.after(() => app.close());

  await writeEntity(
    vault,
    "people",
    "izlenen-kisi",
    "---\ntype: person\nname: İzlenen Kişi\n---\nWatcher gövdesi.\n",
  );
  let found = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await app.inject({ url: "/api/entities/izlenen-kisi" });
    if (response.statusCode === 200) {
      found = true;
      break;
    }
  }
  assert.equal(found, true);
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
