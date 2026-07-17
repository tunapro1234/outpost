import path from "node:path";
import { randomBytes } from "node:crypto";
import { createTmuxFileBridge } from "../../lib/tmux-file-bridge.mjs";

function commandFor(id) {
  return `[copilot ${id}] Soru: copilot/inbox/${id}.md oku; cevabı copilot/outbox/${id}.md dosyasına markdown olarak yaz; bitince copilot/outbox/${id}.done oluştur.`;
}

export function createTmuxBridge({
  now = Date.now,
  idFactory = () => `cp-${now()}-${randomBytes(2).toString("hex")}`,
  session = process.env.OUTPOST_COPILOT_TMUX ?? "outpost-copilot",
  ...options
} = {}) {
  return createTmuxFileBridge({
    ...options,
    now,
    idFactory,
    session,
    label: "Copilot",
    resolveDirectory: ({ workspace }) => ({
      absolute: path.join(workspace.directory, "copilot"),
      relative: "copilot",
    }),
    commandFor,
    busyMessage: "Copilot tmux oturumu meşgul; headless runner kullanılacak",
    timeoutMessage: "Copilot tmux yanıtı 180 saniyede zaman aşımına uğradı",
  });
}
