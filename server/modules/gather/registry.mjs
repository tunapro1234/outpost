import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import yaml from "js-yaml";

const VALID_ZONES = new Set(["gathering", "network"]);
const VALID_TASKS = new Set([
  "scrape-classify",
  "dedup-review",
  "link-discovery",
  "deepen-person",
  "write-mail",
]);
export const GATHER_KINDS = ["discover-company", "discover-person", "enrich"];
const VALID_KINDS = new Set(GATHER_KINDS);
const VALID_PERSON_SOURCES = new Set(["company", "standalone"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const writeQueues = new Map();

function fail(filePath, index, message) {
  throw new Error(`${filePath}: agent ${index + 1}: ${message}`);
}

function cleanAgent(raw, index, filePath) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(filePath, index, "kayıt nesne olmalı");
  }
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
    fail(filePath, index, "geçerli id zorunlu");
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    fail(filePath, index, "name zorunlu");
  }
  if (!VALID_ZONES.has(raw.zone)) {
    fail(filePath, index, "zone gathering veya network olmalı");
  }
  if (typeof raw.model !== "string" || !raw.model.trim()) {
    fail(filePath, index, "model zorunlu");
  }
  if (!VALID_TASKS.has(raw.task)) {
    fail(filePath, index, "geçersiz task");
  }
  if (typeof raw.integration !== "string" || !raw.integration.trim()) {
    fail(filePath, index, "integration zorunlu");
  }
  const kind = raw.kind === undefined ? "enrich" : raw.kind;
  if (!VALID_KINDS.has(kind)) {
    fail(filePath, index, "kind discover-company, discover-person veya enrich olmalı");
  }
  if (raw.source !== undefined) {
    if (kind !== "discover-person") {
      fail(filePath, index, "source yalnızca discover-person için kullanılabilir");
    }
    if (!VALID_PERSON_SOURCES.has(raw.source)) {
      fail(filePath, index, "source company veya standalone olmalı");
    }
  }
  if (raw.target !== undefined && raw.target !== "person") {
    fail(filePath, index, "target yalnızca person olabilir");
  }
  if (
    raw.params !== undefined &&
    (!raw.params || typeof raw.params !== "object" || Array.isArray(raw.params))
  ) {
    fail(filePath, index, "params nesne olmalı");
  }
  if (
    raw.schedule !== undefined &&
    (typeof raw.schedule !== "string" || !raw.schedule.trim())
  ) {
    fail(filePath, index, "schedule manual veya cron-string olmalı");
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    fail(filePath, index, "enabled bool olmalı");
  }

  return {
    id: raw.id,
    name: raw.name.trim(),
    zone: raw.zone,
    model: raw.model.trim(),
    task: raw.task,
    integration: raw.integration.trim(),
    kind,
    ...(raw.target !== undefined ? { target: raw.target } : {}),
    ...(raw.source !== undefined ? { source: raw.source } : {}),
    params: { ...(raw.params ?? {}) },
    schedule: raw.schedule?.trim() || "manual",
    enabled: raw.enabled === true,
  };
}

export async function readAgentRegistry(workspace) {
  const filePath = path.join(workspace.directory, "agents.yaml");
  let parsed;
  try {
    parsed = yaml.load(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const records = Array.isArray(parsed) ? parsed : parsed?.agents;
  if (records === undefined || records === null) return [];
  if (!Array.isArray(records)) {
    throw new Error(`${filePath}: agent listesi dizi olmalı`);
  }

  const agents = records.map((record, index) => cleanAgent(record, index, filePath));
  const ids = new Set();
  for (const agent of agents) {
    if (ids.has(agent.id)) throw new Error(`${filePath}: yinelenen agent id: ${agent.id}`);
    ids.add(agent.id);
  }
  return agents;
}

async function writeAgentDocument(filePath, document) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, yaml.dump(document, { noRefs: true, lineWidth: -1 }), "utf8");
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function updateAgentRegistry(workspace, id, changes) {
  const filePath = path.join(workspace.directory, "agents.yaml");
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let document;
    try {
      document = yaml.load(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        const notFound = new Error("Agent bulunamadı");
        notFound.statusCode = 404;
        throw notFound;
      }
      throw error;
    }
    const records = Array.isArray(document) ? document : document?.agents;
    if (!Array.isArray(records)) {
      throw new Error(`${filePath}: agent listesi dizi olmalı`);
    }
    const record = records.find((candidate) => candidate?.id === id);
    if (!record) {
      const notFound = new Error("Agent bulunamadı");
      notFound.statusCode = 404;
      throw notFound;
    }
    if (changes.schedule !== undefined) record.schedule = changes.schedule;
    if (changes.enabled !== undefined) record.enabled = changes.enabled;
    if (changes.params !== undefined) {
      record.params = { ...(record.params ?? {}), ...changes.params };
    }
    await writeAgentDocument(filePath, document);
    return findAgent(await readAgentRegistry(workspace), id);
  });
  writeQueues.set(filePath, operation);
  try {
    return await operation;
  } finally {
    if (writeQueues.get(filePath) === operation) writeQueues.delete(filePath);
  }
}

export function findAgent(agents, id) {
  return agents.find((agent) => agent.id === id) ?? null;
}
