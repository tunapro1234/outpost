import { promises as fs } from "node:fs";
import path from "node:path";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function journalRoot(workspace) {
  return path.join(workspace.directory, "agent-runs");
}

function safeAgentId(agentId) {
  if (typeof agentId !== "string" || !ID_PATTERN.test(agentId)) {
    throw new Error("Geçersiz agent id");
  }
  return agentId;
}

function timestampName(iso) {
  return iso.replace(/[:.]/g, "-");
}

export function createRunRecord(agentId, { now = () => new Date() } = {}) {
  const started = now().toISOString();
  const stamp = timestampName(started);
  return {
    id: `${safeAgentId(agentId)}--${stamp}`,
    agent_id: agentId,
    started,
    ended: null,
    status: "running",
    items_in: 0,
    items_out: 0,
    staged: 0,
    warnings: [],
    log_tail: "",
    note: null,
  };
}

export async function writeRun(workspace, run) {
  safeAgentId(run.agent_id);
  const directory = path.join(journalRoot(workspace), run.agent_id);
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${timestampName(run.started)}.json`);
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
  return run;
}

async function jsonFiles(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readRunFile(filePath) {
  const value = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath}: run kaydı nesne değil`);
  }
  return value;
}

export async function listRuns(workspace, { agent } = {}) {
  const root = journalRoot(workspace);
  let files = [];
  if (agent) {
    files = await jsonFiles(path.join(root, safeAgentId(agent)));
  } else {
    let directories;
    try {
      directories = (await fs.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    files = (await Promise.all(
      directories.map((entry) => jsonFiles(path.join(root, entry.name))),
    )).flat();
  }
  const records = await Promise.all(files.map(readRunFile));
  return records.sort((left, right) =>
    String(right.started).localeCompare(String(left.started)));
}

export async function readRun(workspace, runId) {
  if (typeof runId !== "string" || !/^[a-z0-9_-]+--[0-9TZ-]+$/i.test(runId)) return null;
  const separator = runId.lastIndexOf("--");
  const agentId = runId.slice(0, separator);
  const stamp = runId.slice(separator + 2);
  const filePath = path.join(journalRoot(workspace), safeAgentId(agentId), `${stamp}.json`);
  try {
    return await readRunFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function latestRun(workspace, agentId) {
  return (await listRuns(workspace, { agent: agentId }))[0] ?? null;
}
