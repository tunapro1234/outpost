import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// bp, token/cache verisini ~/.claude altından okur; systemd ortamında HOME
// tanımlı olmadığından onsuz her satır "-" döner.
const execEnv = () => ({ ...process.env, HOME: process.env.HOME ?? os.homedir() });

export const DEFAULT_BP_PATH = "/usr/local/bin/bp";
export const DEFAULT_AGENTBOOK_PATH = "/srv/probot/.orchestration/agentbook.json";
export const DEFAULT_FLEET_CACHE_MS = 30_000;

const STATUS_LINE = /^(\S+)\s+(idle|busy|closed)\s+((?:warm|cold)\s+\S+\s+\S+|-)\s+(\S+)\s+(\S+)\s*$/;

function cacheFields(raw) {
  if (raw === "-") {
    return { heat: null, age: null, tokens: null };
  }
  const [heat = null, age = null, tokens = null] = raw.split(/\s+/);
  return { heat, age, tokens };
}

export function parseBpStatus(source) {
  const agents = [];
  for (const line of String(source ?? "").split(/\r?\n/).slice(1)) {
    const match = STATUS_LINE.exec(line.trim());
    if (!match) continue;
    const [, name, tmux, cache, lastTalk, agentbook] = match;
    agents.push({
      name,
      tmux,
      status: tmux === "busy" ? "working" : tmux,
      cache: {
        raw: cache,
        ...cacheFields(cache),
      },
      lastTalk: lastTalk === "-" ? null : lastTalk,
      agentbook,
      currentTask: null,
    });
  }
  return agents;
}

function agentbookAgents(document) {
  if (!document || !Array.isArray(document.agents)) return [];
  return document.agents.filter((agent) =>
    agent && typeof agent === "object" && typeof agent.name === "string");
}

export function probotHierarchyNames(document) {
  const agents = agentbookAgents(document);
  const root = typeof document?.orchestrator === "string"
    ? document.orchestrator
    : "probot-main";
  const parentByName = new Map(agents.map((agent) => [agent.name, agent.parent]));
  const included = new Set([root]);

  for (const agent of agents) {
    const seen = new Set();
    let current = agent.name;
    while (typeof current === "string" && current && !seen.has(current)) {
      if (current === root) {
        included.add(agent.name);
        break;
      }
      seen.add(current);
      current = parentByName.get(current);
    }
  }
  return included;
}

export function filterFleetAgents(agents, document) {
  const hierarchy = probotHierarchyNames(document);
  return agents.filter((agent) =>
    agent.name.startsWith("probot") ||
    agent.name.startsWith("op-") ||
    hierarchy.has(agent.name));
}

const TMUX_CHROME = [
  /^[-─━═]{4,}/u,
  /^--\s+(?:INSERT|NORMAL|VISUAL)\s+--/u,
  /^[❯>›]\s*$/u,
  /^\s*$/u,
];

export function lastMeaningfulLine(source) {
  const lines = String(source ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  return lines.reverse().find((line) =>
    !TMUX_CHROME.some((pattern) => pattern.test(line))) ?? "";
}

async function readAgentbook(fileSystem, agentbookPath) {
  try {
    return JSON.parse(await fileSystem.readFile(agentbookPath, "utf8"));
  } catch {
    return null;
  }
}

export class FleetService {
  constructor({
    exec = execFileAsync,
    fileSystem = fs,
    bpPath = DEFAULT_BP_PATH,
    agentbookPath = DEFAULT_AGENTBOOK_PATH,
    cacheMs = DEFAULT_FLEET_CACHE_MS,
    now = () => Date.now(),
  } = {}) {
    this.exec = exec;
    this.fileSystem = fileSystem;
    this.bpPath = bpPath;
    this.agentbookPath = agentbookPath;
    this.cacheMs = cacheMs;
    this.now = now;
    this.cached = null;
    this.loading = null;
  }

  async load() {
    const timestamp = this.now();
    if (this.cached && timestamp - this.cached.timestamp < this.cacheMs) {
      return this.cached.value;
    }
    if (this.loading) return this.loading;
    this.loading = this.refresh(timestamp).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async refresh(timestamp = this.now()) {
    let stdout;
    try {
      ({ stdout = "" } = await this.exec(
        this.bpPath,
        ["status"],
        { timeout: 5_000, maxBuffer: 1024 * 1024, env: execEnv() },
      ));
    } catch {
      const value = {
        agents: [],
        unavailable: true,
        updatedAt: new Date(timestamp).toISOString(),
      };
      this.cached = { timestamp, value };
      return value;
    }

    const agentbook = await readAgentbook(this.fileSystem, this.agentbookPath);
    const agents = filterFleetAgents(parseBpStatus(stdout), agentbook);
    await Promise.all(agents.map(async (agent) => {
      if (agent.tmux === "closed") return;
      try {
        const capture = await this.exec(
          "tmux",
          ["capture-pane", "-p", "-t", agent.name],
          { timeout: 3_000, maxBuffer: 256 * 1024, env: execEnv() },
        );
        agent.currentTask = lastMeaningfulLine(capture.stdout);
      } catch {
        agent.currentTask = "unavailable";
      }
    }));

    const value = {
      agents,
      unavailable: false,
      updatedAt: new Date(timestamp).toISOString(),
    };
    this.cached = { timestamp, value };
    return value;
  }
}
