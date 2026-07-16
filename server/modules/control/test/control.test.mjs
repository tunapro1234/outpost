import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../app.mjs";
import { ControlRegistry } from "../registry.mjs";
import { isInternalPath, validateCommand } from "../routes.mjs";

const EXAMPLE_VAULT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../example-vault",
);

class MemoryStream {
  constructor() {
    this.chunks = [];
    this.destroyed = false;
    this.writableEnded = false;
  }

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }

  end() {
    this.writableEnded = true;
  }
}

async function fixtureApp(t, defaultUser = "") {
  const controlRegistry = new ControlRegistry({ heartbeatMs: 0 });
  const app = await createApp({
    vaultPath: EXAMPLE_VAULT,
    watch: false,
    defaultUser,
    controlRegistry,
  });
  t.after(() => app.close());
  return { app, controlRegistry };
}

test("kayıt defteri kullanıcı oturumlarını ayırır, kaldırır ve SSE formatında teslim eder", () => {
  const registry = new ControlRegistry({ heartbeatMs: 0 });
  const first = new MemoryStream();
  const second = new MemoryStream();
  const other = new MemoryStream();
  const removeFirst = registry.add("tuna", first);
  registry.add("tuna", second);
  registry.add("deniz", other);

  const command = { id: "command-1", action: "navigate", path: "/network" };
  assert.equal(registry.count("tuna"), 2);
  assert.equal(registry.deliver("tuna", command), 2);
  assert.deepEqual(first.chunks, [`data: ${JSON.stringify(command)}\n\n`]);
  assert.deepEqual(second.chunks, first.chunks);
  assert.deepEqual(other.chunks, []);

  removeFirst();
  assert.equal(registry.count("tuna"), 1);
  assert.equal(registry.deliver("tuna", command), 1);
  registry.close();
});

test("control endpoint kimliği header'dan veya default kullanıcıdan alır, ikisi de yoksa 401 döner", async (t) => {
  const anonymous = await fixtureApp(t, "");
  const denied = await anonymous.app.inject({
    method: "POST",
    url: "/api/control/command",
    payload: { action: "toast", message: "hello" },
  });
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(denied.json(), { error: "authentication required" });
  const deniedStream = await anonymous.app.inject({
    method: "GET",
    url: "/api/control/stream",
  });
  assert.equal(deniedStream.statusCode, 401);
  assert.deepEqual(deniedStream.json(), { error: "authentication required" });
  assert.deepEqual((await anonymous.app.inject({
    method: "POST",
    url: "/api/control/command",
    headers: { "x-remote-user": "tuna" },
    payload: { action: "toast", message: "hello" },
  })).json(), { delivered: 0 });

  const fallback = await fixtureApp(t, "tuna");
  const stream = new MemoryStream();
  fallback.controlRegistry.add("tuna", stream);
  const accepted = await fallback.app.inject({
    method: "POST",
    url: "/api/control/command",
    payload: { action: "toast", message: "hello" },
  });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), { delivered: 1 });
});

test("aksiyon allowlist'i yalnız geçerli v1 komutlarını kabul eder", async (t) => {
  const { app } = await fixtureApp(t, "tuna");
  const invalid = [
    { action: "reload" },
    { action: "navigate", path: "https://example.com" },
    { action: "navigate", path: "//example.com/network" },
    { action: "navigate", path: "/\\example.com/network" },
    { action: "open-entity", id: "" },
    { action: "set-workspace", ws: 42 },
    { action: "set-theme", theme: "system" },
    { action: "toast", message: "" },
  ];
  for (const payload of invalid) {
    const response = await app.inject({
      method: "POST",
      url: "/api/control/command",
      payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }

  assert.equal(isInternalPath("/network?mode=list"), true);
  const valid = [
    { action: "navigate", path: "/network" },
    { action: "open-entity", id: "entity-1", ws: "main" },
    { action: "set-workspace", ws: "main" },
    { action: "set-theme", theme: "light" },
    { action: "toast", message: "done" },
  ];
  for (const payload of valid) assert.doesNotThrow(() => validateCommand(payload));
});

test("target yalnız localhost'tan kabul edilir ve teslimat sayısı hedef kullanıcının oturumlarıdır", async (t) => {
  const { app, controlRegistry } = await fixtureApp(t, "");
  const tuna = new MemoryStream();
  const deniz = new MemoryStream();
  controlRegistry.add("tuna", tuna);
  controlRegistry.add("deniz", deniz);

  const remoteTarget = await app.inject({
    method: "POST",
    url: "/api/control/command",
    remoteAddress: "198.51.100.8",
    headers: { "x-remote-user": "tuna" },
    payload: { action: "navigate", path: "/network", target: "deniz" },
  });
  assert.equal(remoteTarget.statusCode, 403);
  assert.deepEqual(deniz.chunks, []);

  const remoteSelf = await app.inject({
    method: "POST",
    url: "/api/control/command",
    remoteAddress: "198.51.100.8",
    headers: { "x-remote-user": "tuna" },
    payload: { action: "navigate", path: "/network" },
  });
  assert.deepEqual(remoteSelf.json(), { delivered: 1 });

  const localTarget = await app.inject({
    method: "POST",
    url: "/api/control/command",
    remoteAddress: "::1",
    headers: { "x-remote-user": "tuna" },
    payload: { action: "set-theme", theme: "dark", target: "deniz" },
  });
  assert.deepEqual(localTarget.json(), { delivered: 1 });
  const event = JSON.parse(deniz.chunks[0].slice("data: ".length).trim());
  assert.equal(event.action, "set-theme");
  assert.equal(event.theme, "dark");
  assert.equal(typeof event.id, "string");
  assert.equal(Object.hasOwn(event, "target"), false);
});
