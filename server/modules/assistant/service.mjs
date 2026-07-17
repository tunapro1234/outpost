import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toAscii } from "../../lib/slug.mjs";
import {
  personalAgentExec,
  personalAgentSleep,
  spawnPersonalAgentSession,
} from "../../lib/personal-agent-session.mjs";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BRIEF_TEMPLATE = path.join(MODULE_DIRECTORY, "assistant-brief.md");

export function agentSlug(value) {
  return toAscii(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function workspaceAgentSession(workspace) {
  return `op-ws-${workspace.code ?? workspace.id}`;
}

export function personalAgentSession(workspace, displayName, username) {
  const userSlug = agentSlug(displayName) || agentSlug(username);
  return `${workspaceAgentSession(workspace)}-usr-${userSlug}`;
}

export function renderAssistantBrief(template, { user, workspaceId, workspaceCode }) {
  return template
    .replaceAll("{{user}}", () => user)
    .replaceAll("{{ws}}", () => workspaceId)
    .replaceAll("{{code}}", () => workspaceCode);
}

export async function ensureAssistantBrief(workspace, user, {
  fileSystem = fs,
  templatePath = DEFAULT_BRIEF_TEMPLATE,
} = {}) {
  const assistantDirectory = path.join(workspace.directory, "assistant");
  const briefPath = path.join(assistantDirectory, "CLAUDE-ASSIST.md");
  await fileSystem.mkdir(assistantDirectory, { recursive: true, mode: 0o700 });
  await fileSystem.chmod(assistantDirectory, 0o700);
  const template = await fileSystem.readFile(templatePath, "utf8");
  const brief = renderAssistantBrief(template, {
    user,
    workspaceId: workspace.id,
    workspaceCode: workspace.code ?? workspace.id,
  });
  try {
    await fileSystem.writeFile(briefPath, brief, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return briefPath;
}

export async function spawnAssistantSession({
  workspace,
  user,
  session = personalAgentSession(workspace, user, user),
  exec = personalAgentExec,
  sleep = personalAgentSleep,
  spawnWaitMs = 30_000,
  claudeBin = process.env.OUTPOST_CLAUDE_BIN ?? "claude",
}) {
  return spawnPersonalAgentSession({
    workspace,
    session,
    model: "claude-sonnet-5",
    protocol: "assist",
    label: "Asistan",
    exec,
    sleep,
    spawnWaitMs,
    claudeBin,
  });
}

export { personalAgentSleep as assistantSleep, personalAgentExec as assistantExec };
