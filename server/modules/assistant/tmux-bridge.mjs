import { randomBytes } from "node:crypto";
import path from "node:path";
import { createTmuxFileBridge } from "../../lib/tmux-file-bridge.mjs";
import {
  assistantExec,
  assistantSleep,
  ensureAssistantBrief,
  spawnAssistantSession,
} from "./service.mjs";

function commandFor(user) {
  return (id) =>
    `[assist ${id}] Soru: assistant/${user}/inbox/${id}.md oku; cevabı assistant/${user}/outbox/${id}.md dosyasına markdown olarak yaz; bitince assistant/${user}/outbox/${id}.done oluştur.`;
}

export function createAssistantTmuxBridge({
  user,
  session,
  exec = assistantExec,
  fileSystem,
  sleep = assistantSleep,
  now = Date.now,
  idFactory = () => `assist-${now()}-${randomBytes(2).toString("hex")}`,
  claudeBin,
  briefTemplatePath,
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
    label: "Asistan",
    logger,
    busyMessage: "Asistan tmux oturumu meşgul",
    timeoutMessage: "Asistan tmux yanıtı 180 saniyede zaman aşımına uğradı",
    resolveDirectory: ({ workspace }) => ({
      absolute: path.join(workspace.directory, "assistant", user),
      relative: `assistant/${user}`,
    }),
    commandFor: commandFor(user),
    onMissingSession: async ({ workspace }) => {
      await spawnAssistantSession({
        workspace,
        user,
        session,
        exec,
        sleep,
        spawnWaitMs,
        claudeBin,
      });
    },
  });
}

export async function prepareAssistant(workspace, user, options = {}) {
  return ensureAssistantBrief(workspace, user, {
    fileSystem: options.fileSystem,
    templatePath: options.briefTemplatePath,
  });
}
