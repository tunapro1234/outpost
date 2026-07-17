import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTmuxFileBridge } from "../../lib/tmux-file-bridge.mjs";
import {
  personalAgentExec,
  personalAgentSleep,
  spawnPersonalAgentSession,
} from "../../lib/personal-agent-session.mjs";
import { personalAgentSession } from "../assistant/service.mjs";

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MAIL_AGENT_BRIEF = path.join(MODULE_DIRECTORY, "mail-agent-brief.md");

export function mailAgentSession(workspace, displayName, username) {
  return `${personalAgentSession(workspace, displayName, username)}-mail`;
}

export function renderMailAgentBrief(template, { user, workspaceId }) {
  return template
    .replaceAll("{{user}}", () => user)
    .replaceAll("{{ws}}", () => workspaceId);
}

export async function ensureMailAgentBrief(workspace, user, {
  fileSystem = fs,
  templatePath = DEFAULT_MAIL_AGENT_BRIEF,
} = {}) {
  const directory = path.join(workspace.directory, "mailagent", user);
  const briefPath = path.join(directory, "CLAUDE-MAIL.md");
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  await fileSystem.chmod(directory, 0o700);
  const template = await fileSystem.readFile(templatePath, "utf8");
  try {
    await fileSystem.writeFile(briefPath, renderMailAgentBrief(template, {
      user,
      workspaceId: workspace.id,
    }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return briefPath;
}

export async function spawnMailAgentSession({
  workspace,
  session,
  model = "claude-opus-4-8",
  exec = personalAgentExec,
  sleep = personalAgentSleep,
  spawnWaitMs,
  claudeBin,
}) {
  return spawnPersonalAgentSession({
    workspace,
    session,
    model,
    protocol: "mail",
    label: "Mail agent",
    exec,
    sleep,
    spawnWaitMs,
    claudeBin,
  });
}

export function createMailAgentBridge({
  user,
  session,
  model = "claude-opus-4-8",
  exec = personalAgentExec,
  fileSystem,
  sleep = personalAgentSleep,
  now = Date.now,
  idFactory = () => `mail-${now()}-${randomBytes(2).toString("hex")}`,
  claudeBin,
  spawnWaitMs,
  logger,
  ...options
}) {
  return createTmuxFileBridge({
    ...options,
    exec,
    fileSystem,
    sleep,
    now,
    idFactory,
    session,
    label: "Mail agent",
    logger,
    busyMessage: "Mail agent tmux oturumu meşgul",
    timeoutMessage: "Mail agent tmux yanıtı 180 saniyede zaman aşımına uğradı",
    resolveDirectory: ({ workspace }) => ({
      absolute: path.join(workspace.directory, "mailagent", user),
      relative: `mailagent/${user}`,
    }),
    commandFor: (id) =>
      `[mail ${id}] İstek: mailagent/${user}/inbox/${id}.md oku; cevabı mailagent/${user}/outbox/${id}.md dosyasına yaz; bitince mailagent/${user}/outbox/${id}.done oluştur.`,
    onMissingSession: async ({ workspace }) => {
      await spawnMailAgentSession({
        workspace, session, model, exec, sleep, spawnWaitMs, claudeBin,
      });
    },
  });
}
