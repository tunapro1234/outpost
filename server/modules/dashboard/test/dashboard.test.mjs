import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { defaultDashboard, SECTION_IDS } from "../service.mjs";

async function fixture(t) {
  const root = await temporaryDirectory("outpost-dashboard-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  await fs.mkdir(path.join(directory, "vault"), { recursive: true });
  await fs.writeFile(path.join(directory, "config.yaml"), "name: Fixture\n", "utf8");
  return { root, directory };
}

async function appFor(t, root, defaultUser = "tuna") {
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    defaultUser,
  });
  t.after(() => app.close());
  return app;
}

test("dashboard GET kimlik ister ve dosya yoksa varsayılan düzeni üretir", async (t) => {
  const { root, directory } = await fixture(t);
  const app = await appFor(t, root, "");

  const anonymous = await app.inject({ url: "/api/ws/fixture/dashboard" });
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.json(), { error: "authentication required" });

  const response = await app.inject({
    url: "/api/ws/fixture/dashboard",
    headers: { "x-remote-user": "ada" },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), defaultDashboard());
  await assert.rejects(fs.access(path.join(directory, "dashboards", "ada.json")), {
    code: "ENOENT",
  });
});

test("dashboard PUT yalnız kimlikteki kullanıcıya yazar ve GET kalıcı düzeni okur", async (t) => {
  const { root, directory } = await fixture(t);
  const app = await appFor(t, root);
  const layout = {
    sections: [
      { id: "prompt", visible: true },
      { id: "activity", visible: false },
      { id: "kpis", visible: true },
      { id: "types", visible: true },
      { id: "mailchart", visible: false },
      { id: "maildrafts", visible: true },
    ],
    notes: { mail_tone: "resmi", last_context: "Yanıt bekleyen mailler" },
  };

  const saved = await app.inject({
    method: "PUT",
    url: "/api/ws/fixture/dashboard",
    headers: { "x-remote-user": "ada" },
    payload: layout,
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), layout);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(directory, "dashboards", "ada.json"), "utf8")),
    layout,
  );
  await assert.rejects(fs.access(path.join(directory, "dashboards", "tuna.json")), {
    code: "ENOENT",
  });

  const loaded = await app.inject({
    url: "/api/ws/fixture/dashboard",
    headers: { "x-remote-user": "ada" },
  });
  assert.deepEqual(loaded.json(), layout);
});

test("dashboard PUT bölüm, visible ve notes sözleşmesini doğrular", async (t) => {
  const { root, directory } = await fixture(t);
  const app = await appFor(t, root);
  const valid = defaultDashboard();
  const attempts = [
    { ...valid, sections: valid.sections.map((section, index) =>
      index === 0 ? { id: "bilinmeyen", visible: true } : section) },
    { ...valid, sections: valid.sections.map((section, index) =>
      index === 0 ? { ...section, visible: "evet" } : section) },
    { ...valid, sections: valid.sections.map((section) =>
      section.id === "prompt" ? { ...section, visible: false } : section) },
    { ...valid, notes: Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => [`not_${index}`, "değer"]),
    ) },
    { ...valid, notes: { tercih: 42 } },
  ];

  for (const payload of attempts) {
    const response = await app.inject({
      method: "PUT",
      url: "/api/ws/fixture/dashboard",
      headers: { "x-remote-user": "ada" },
      payload,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.deepEqual(SECTION_IDS, [
    "kpis", "prompt", "maildrafts", "mailchart", "types", "activity",
  ]);
  await assert.rejects(fs.access(path.join(directory, "dashboards", "ada.json")), {
    code: "ENOENT",
  });
});
