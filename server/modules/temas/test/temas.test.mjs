import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { seedWorkspaceTemas } from "../../../scripts/seed-temas.mjs";
import {
  temporaryDirectory,
  writeEntity,
} from "../../../test-support/helpers.mjs";

async function fixture() {
  const root = await temporaryDirectory("outpost-temas-");
  const directory = path.join(root, "fixture");
  const intel = path.join(directory, "intel");
  const hedef = path.join(directory, "hedef");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "config.yaml"),
    [
      "name: Fixture",
      "default_network: intel",
      "networks:",
      "  - id: intel",
      "    vault_path: intel",
      "  - id: hedef",
      "    vault_path: hedef",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeEntity(
    intel,
    "companies",
    "unrelated",
    "---\ntype: company\nname: Unrelated\n---\n",
  );
  return { root, directory, hedef };
}

async function person(vault, id, extra = "") {
  await writeEntity(
    vault,
    "people",
    id,
    `---\ntype: person\nname: ${id}\n${extra}---\n`,
  );
}

test("temas_durumu GET/PATCH overlay'i ve PATCH sonrası export", async (t) => {
  const { root, directory, hedef } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await person(hedef, "ada");
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
  });
  t.after(() => app.close());

  const initial = await app.inject({ url: "/api/ws/fixture/temas/ada" });
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json(), {
    entity_id: "ada",
    durum: "yazilmadi",
    guncelleme_ts: null,
    kaynak: null,
  });

  const invalid = await app.inject({
    method: "PATCH",
    url: "/api/ws/fixture/temas/ada",
    payload: { durum: "mesaj-gonder" },
  });
  assert.equal(invalid.statusCode, 400);
  const automated = await app.inject({
    method: "PATCH",
    url: "/api/ws/fixture/temas/ada",
    payload: { durum: "yazildi", kaynak: "agent" },
  });
  assert.equal(automated.statusCode, 400);

  const patched = await app.inject({
    method: "PATCH",
    url: "/api/ws/fixture/temas/ada",
    payload: { durum: "cevap_bekleniyor" },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().entity_id, "ada");
  assert.equal(patched.json().durum, "cevap_bekleniyor");
  assert.equal(patched.json().kaynak, "ui:tuna");
  assert.ok(!Number.isNaN(Date.parse(patched.json().guncelleme_ts)));

  const fetched = await app.inject({ url: "/api/ws/fixture/temas/ada" });
  assert.deepEqual(fetched.json(), patched.json());
  const exported = JSON.parse(
    await fs.readFile(path.join(directory, "temas-export.json"), "utf8"),
  );
  assert.deepEqual(exported, [patched.json()]);
  assert.deepEqual(Object.keys(exported[0]), [
    "entity_id",
    "durum",
    "guncelleme_ts",
    "kaynak",
  ]);

  assert.equal((await app.inject({
    url: "/api/ws/fixture/temas/yok",
  })).statusCode, 404);
});

test("temas overlay hedef vault build'inden etkilenmez", async (t) => {
  const { root, hedef } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await person(hedef, "ada");
  const first = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
  });
  const patched = await first.inject({
    method: "PATCH",
    url: "/api/ws/fixture/temas/ada",
    payload: { durum: "cevaplanacak" },
  });
  assert.equal(patched.statusCode, 200);
  await first.close();

  // A build replaces only the target vault. The workspace DB stays put.
  await fs.rm(hedef, { recursive: true, force: true });
  await person(hedef, "ada", "city: İstanbul\n");
  const rebuilt = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
  });
  t.after(() => rebuilt.close());
  const result = await rebuilt.inject({ url: "/api/ws/fixture/temas/ada" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().durum, "cevaplanacak");
  assert.equal(result.json().kaynak, "ui:tuna");
});

test("elle doğrulanmış temas tohumu idempotent ve politika kayıtlarını atlar", async (t) => {
  const { root, hedef } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await person(hedef, "selim-cile");
  await person(hedef, "murat-kaya");
  await person(hedef, "onur-aydemir");
  await person(hedef, "firat-sevim");
  await person(hedef, "fatih-tufekci");
  await person(hedef, "diger-kisi");
  await person(hedef, "aranmayacak", "politika_durumu: no_contact\n");
  await person(hedef, "ertelenen", "politika_durumu: defer\n");
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
  });
  t.after(() => app.close());
  const workspace = app.workspaceRegistry.get("fixture");

  assert.equal(await seedWorkspaceTemas(workspace), 6);
  assert.equal(await seedWorkspaceTemas(workspace), 0);
  const exported = JSON.parse(
    await fs.readFile(path.join(workspace.directory, "temas-export.json"), "utf8"),
  );
  assert.deepEqual(
    exported.map(({ entity_id, durum, kaynak }) => ({ entity_id, durum, kaynak })),
    [
      { entity_id: "diger-kisi", durum: "yazilmadi", kaynak: "seed" },
      { entity_id: "fatih-tufekci", durum: "yazilmadi", kaynak: "seed" },
      { entity_id: "firat-sevim", durum: "cevap_bekleniyor", kaynak: "seed" },
      { entity_id: "murat-kaya", durum: "cevaplanacak", kaynak: "seed" },
      { entity_id: "onur-aydemir", durum: "cevap_bekleniyor", kaynak: "seed" },
      { entity_id: "selim-cile", durum: "yazilmadi", kaynak: "seed" },
    ],
  );

  await app.inject({
    method: "PATCH",
    url: "/api/ws/fixture/temas/selim-cile",
    payload: { durum: "gorusuldu" },
  });
  assert.equal(await seedWorkspaceTemas(workspace), 0);
  const selim = await app.inject({ url: "/api/ws/fixture/temas/selim-cile" });
  assert.equal(selim.json().durum, "gorusuldu");
  assert.equal(selim.json().kaynak, "ui:tuna");
});
