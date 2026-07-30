import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { FleetService, lastMeaningfulLine, parseBpStatus } from "../service.mjs";

const REAL_BP_STATUS = `AGENT                    TMUX       CACHE                LAST-TALK  AGENTBOOK
archive-batuhan          closed     cold 29.6d 24.4k     29.6d      closed
op-main                  idle       warm 0m 146.9k       0m         open
op-ws-prb-usr-tuna-gul-mail closed     cold 3.8d 71.4k      4.1d       closed
probot-business          busy       cold 80m 213.5k      77m        open
probot-builder-designer  closed     -                    -          closed
worker-without-prefix    idle       warm 2m 70.8k        1m         open
`;

const AGENTBOOK = {
  orchestrator: "probot-main",
  agents: [
    { name: "probot-main", parent: "server-main" },
    { name: "worker-without-prefix", parent: "probot-main" },
  ],
};

test("bp status parser gerçek kolonları, uzun adları ve boş cache'i ayrıştırır", () => {
  const agents = parseBpStatus(REAL_BP_STATUS);
  assert.equal(agents.length, 6);
  assert.deepEqual(agents[1], {
    name: "op-main",
    tmux: "idle",
    status: "idle",
    cache: { raw: "warm 0m 146.9k", heat: "warm", age: "0m", tokens: "146.9k" },
    lastTalk: "0m",
    agentbook: "open",
    currentTask: null,
  });
  assert.equal(agents[2].name, "op-ws-prb-usr-tuna-gul-mail");
  assert.equal(agents[3].status, "working");
  assert.deepEqual(agents[4].cache, {
    raw: "-",
    heat: null,
    age: null,
    tokens: null,
  });
  assert.equal(agents[4].lastTalk, null);
});

test("fleet exec mock ile filtreler, capture-pane okur ve 30sn cache kullanır", async () => {
  const calls = [];
  const service = new FleetService({
    now: () => 1_783_200_000_000,
    fileSystem: {
      readFile: async () => JSON.stringify(AGENTBOOK),
    },
    exec: async (file, args) => {
      calls.push([file, args]);
      if (file.endsWith("/bp")) return { stdout: REAL_BP_STATUS };
      if (args.at(-1) === "probot-business") throw new Error("pane kapandı");
      return {
        stdout: "Son tamamlanan iş\n\nYeni araştırmayı tarıyor\n────────────\n❯\n-- INSERT --\n",
      };
    },
  });

  const first = await service.load();
  const second = await service.load();
  assert.strictEqual(second, first);
  assert.deepEqual(first.agents.map((agent) => agent.name), [
    "op-main",
    "op-ws-prb-usr-tuna-gul-mail",
    "probot-business",
    "probot-builder-designer",
    "worker-without-prefix",
  ]);
  assert.equal(first.agents[0].currentTask, "Yeni araştırmayı tarıyor");
  assert.equal(first.agents[2].currentTask, "unavailable");
  assert.equal(first.agents[1].currentTask, null);
  assert.equal(calls.filter(([file]) => file.endsWith("/bp")).length, 1);
  assert.deepEqual(calls[1], [
    "tmux",
    ["capture-pane", "-p", "-t", "op-main"],
  ]);
  assert.equal(calls.some(([, args]) => args.includes("send-keys")), false);
});

test("bp exec hatası sayfayı düşürmek yerine boş unavailable sonuç verir", async () => {
  const service = new FleetService({
    now: () => 1_783_200_000_000,
    exec: async () => {
      throw new Error("bp yok");
    },
  });
  assert.deepEqual(await service.load(), {
    agents: [],
    unavailable: true,
    updatedAt: "2026-07-04T21:20:00.000Z",
  });
  assert.equal(lastMeaningfulLine("\n────\n❯\n"), "");
});

test("GET /api/ws/:ws/fleet servis sonucunu endpoint'ten döndürür", async (t) => {
  const vault = await temporaryDirectory("outpost-fleet-");
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const app = await createApp({
    vaultPath: vault,
    watch: false,
    fleetNow: () => 1_783_200_000_000,
    fleetFileSystem: {
      readFile: async () => JSON.stringify(AGENTBOOK),
    },
    fleetExec: async (file) => file.endsWith("/bp")
      ? { stdout: REAL_BP_STATUS }
      : { stdout: "Aktif işi yürütüyor\n❯\n" },
  });
  t.after(() => app.close());

  const response = await app.inject({ url: "/api/ws/default/fleet" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().unavailable, false);
  assert.equal(response.json().agents[0].name, "op-main");
  assert.equal(response.json().agents[0].currentTask, "Aktif işi yürütüyor");
});
