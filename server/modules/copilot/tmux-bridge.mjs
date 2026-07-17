import path from "node:path";
import { randomBytes } from "node:crypto";
import { createTmuxFileBridge } from "../../lib/tmux-file-bridge.mjs";

function commandFor(id) {
  return `[copilot ${id}] Soru: copilot/inbox/${id}.md oku; cevabı copilot/outbox/${id}.md dosyasına markdown olarak yaz; bitince copilot/outbox/${id}.done oluştur.`;
}

export function createTmuxBridge({
  now = Date.now,
  idFactory = () => `cp-${now()}-${randomBytes(2).toString("hex")}`,
  session = process.env.OUTPOST_COPILOT_TMUX,
  ...options
} = {}) {
  const bridges = new Map();
  return async (prompt, context = {}) => {
    const workspaceCode = context.workspace?.code ?? context.workspace?.id;
    const resolvedSession = session ?? `op-ws-${workspaceCode}`;
    let bridge = bridges.get(resolvedSession);
    if (!bridge) {
      bridge = createTmuxFileBridge({
        ...options,
        now,
        idFactory,
        session: resolvedSession,
        label: "Copilot",
        resolveDirectory: ({ workspace }) => ({
          absolute: path.join(workspace.directory, "copilot"),
          relative: "copilot",
        }),
        commandFor,
        busyMessage: "Copilot tmux oturumu meşgul; headless runner kullanılacak",
        timeoutMessage: "Copilot tmux yanıtı 180 saniyede zaman aşımına uğradı",
      });
      bridges.set(resolvedSession, bridge);
    }
    return bridge(prompt, context);
  };
}
