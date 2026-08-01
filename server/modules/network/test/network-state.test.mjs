import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory, writeEntity } from "../../../test-support/helpers.mjs";
import { deriveEntityState } from "../service.mjs";

function entity(durum) {
  return { meta: { ...(durum ? { durum } : {}) } };
}

test("state türetme manual override, temas, mail ve durum önceliklerini uygular", () => {
  assert.equal(deriveEntityState({ entity: entity("yazilacak") }).state, 1);
  assert.equal(deriveEntityState({
    entity: entity("yazilacak"),
    mail: { out: true, in: false },
  }).state, 2);
  assert.equal(deriveEntityState({
    entity: entity("yazilacak"),
    mail: { out: true, in: true },
  }).state, 3);
  assert.equal(deriveEntityState({
    entity: entity("aktif"),
    interaction: { out: true, in: false },
  }).state, 4);
  assert.deepEqual(deriveEntityState({
    entity: entity("aktif"),
    status: {
      outreach_state: 1,
      state_source: "manual",
      research_status: "active",
    },
    interaction: { out: true, in: true },
    mail: { out: true, in: true },
  }), {
    state: 1,
    state_source: "manual",
    research_status: "active",
    flags: { internal: false, no_contact: false },
  });
  assert.deepEqual(deriveEntityState({ entity: entity("ic") }), {
    state: null,
    state_source: "derived",
    research_status: "none",
    flags: { internal: true, no_contact: false },
  });
  assert.deepEqual(deriveEntityState({ entity: entity("temas-yasak") }), {
    state: null,
    state_source: "derived",
    research_status: "none",
    flags: { internal: false, no_contact: true },
  });
  assert.deepEqual(deriveEntityState({
    entity: { meta: { flags: { no_contact: true } } },
  }), {
    state: null,
    state_source: "derived",
    research_status: "none",
    flags: { internal: false, no_contact: true },
  });
});

test("interactions CRUD ve status upsert payloadları entity durumuna yansır", async (t) => {
  const vault = await temporaryDirectory("outpost-interactions-");
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  await writeEntity(
    vault,
    "people",
    "ada",
    "---\ntype: person\nname: Ada\ndurum: yazilacak\n---\n",
  );
  const app = await createApp({ vaultPath: vault, watch: false });
  t.after(() => app.close());

  const invalid = await app.inject({
    method: "POST",
    url: "/api/ws/default/entity/ada/interactions",
    payload: { channel: "telegram" },
  });
  assert.equal(invalid.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: "/api/ws/default/entity/ada/interactions",
    headers: { "x-remote-user": "tuna" },
    payload: {
      channel: "whatsapp",
      at: "2026-07-29T10:00:00.000Z",
      note: "İlk temas",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(
    Object.fromEntries(
      ["entity_id", "channel", "direction", "at", "note", "source"]
        .map((key) => [key, created.json()[key]]),
    ),
    {
      entity_id: "ada",
      channel: "whatsapp",
      direction: "out",
      at: "2026-07-29T10:00:00.000Z",
      note: "İlk temas",
      source: "tuna",
    },
  );

  const interactions = (await app.inject({
    url: "/api/ws/default/entity/ada/interactions",
  })).json();
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].id, created.json().id);
  let statusMap = (await app.inject({
    url: "/api/ws/default/status-map",
  })).json();
  assert.deepEqual(statusMap.ada, {
    state: 2,
    state_source: "derived",
    research_status: "none",
  });

  const updated = await app.inject({
    method: "PUT",
    url: "/api/ws/default/entity/ada/status",
    payload: { outreach_state: 5, research_status: "active", agent: "scout" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().state, 5);
  assert.equal(updated.json().state_source, "manual");
  assert.equal(updated.json().research_status, "active");

  statusMap = (await app.inject({ url: "/api/ws/default/status-map" })).json();
  assert.deepEqual(statusMap.ada, {
    state: 5,
    state_source: "manual",
    research_status: "active",
  });
  const node = (await app.inject({ url: "/api/ws/default/graph" })).json().nodes[0];
  assert.equal(node.state, 5);
  assert.equal(node.research_status, "active");
  assert.deepEqual(node.flags, { internal: false, no_contact: false });
  const item = (await app.inject({ url: "/api/ws/default/entities" })).json()[0];
  assert.equal(item.state, 5);
  const detail = (await app.inject({ url: "/api/ws/default/entities/ada" })).json();
  assert.equal(detail.state, 5);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/ws/default/entity/ada/interactions/${created.json().id}`,
  });
  assert.deepEqual(deleted.json(), { ok: true });
  assert.deepEqual((await app.inject({
    url: "/api/ws/default/entity/ada/interactions",
  })).json(), []);
});

test("graph hidden_nodes düğümlerini ve değen edge'leri varsayılan olarak çıkarır", async (t) => {
  const root = await temporaryDirectory("outpost-hidden-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "fixture");
  const vault = path.join(directory, "vault");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "config.yaml"),
    "name: Fixture\nhidden_nodes: [gizli]\n",
    "utf8",
  );
  await writeEntity(
    vault,
    "people",
    "gizli",
    "---\ntype: person\nname: Gizli\n---\n## İlişkiler\n- [[Açık]] — tanır\n",
  );
  await writeEntity(
    vault,
    "people",
    "acik",
    "---\ntype: person\nname: Açık\n---\n",
  );

  const app = await createApp({ workspacesPath: root, outpostVault: null, watch: false });
  t.after(() => app.close());
  const clean = (await app.inject({ url: "/api/ws/fixture/graph" })).json();
  assert.deepEqual(clean.nodes.map((node) => node.id), ["acik"]);
  assert.deepEqual(clean.edges, []);
  assert.equal(clean.hidden_count, 1);

  const revealed = (await app.inject({
    url: "/api/ws/fixture/graph?include_hidden=1",
  })).json();
  assert.deepEqual(revealed.nodes.map((node) => node.id).sort(), ["acik", "gizli"]);
  assert.equal(revealed.edges.length, 1);
  assert.equal(revealed.hidden_count, 1);
});
