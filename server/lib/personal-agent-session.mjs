import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { BUSY, createBusyProbe } from "./agent-busy.mjs";

export const personalAgentExec = promisify(execFile);

export function personalAgentSleep(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

export async function spawnPersonalAgentSession({
  workspace,
  session,
  model,
  protocol,
  label,
  exec = personalAgentExec,
  sleep = personalAgentSleep,
  spawnWaitMs = 30_000,
  claudeBin = process.env.OUTPOST_CLAUDE_BIN ?? "claude",
  busyProbe,
}) {
  const probe = busyProbe ?? createBusyProbe({ exec });
  const command = `IS_SANDBOX=1 ${claudeBin} --dangerously-skip-permissions --model ${model}`;
  try {
    await exec("tmux", [
      "new-session", "-d", "-s", session, "-c", workspace.directory, command,
    ]);

    const deadline = Date.now() + spawnWaitMs;
    const pollMs = Math.min(1_000, Math.max(1, Math.floor(spawnWaitMs / 5)));
    let ready = false;
    do {
      await sleep(pollMs);
      try {
        const { stdout } = await exec("tmux", ["capture-pane", "-t", session, "-p"]);
        if (typeof stdout === "string" && stdout.includes("❯")) {
          ready = true;
          break;
        }
      } catch {
        // TUI pane'i henüz oluşmadıysa son tarihe kadar bekle.
      }
    } while (Date.now() < deadline);
    if (!ready) throw new Error("claude TUI zamanında hazır olmadı");

    const instruction = `talimat dosyanı oku; protokol: [${protocol} <id>] mesajları`;
    await exec("tmux", ["send-keys", "-t", session, "-l", instruction]);
    await exec("tmux", ["send-keys", "-t", session, "Enter"]);
    // Submit doğrulaması: TUI metni yerine sürümden bağımsız iki sinyal —
    // bp agent'ı çalışıyor görüyor mu, yoksa yazdığımız talimat hâlâ composer'da mı.
    // (Neden desen aramıyoruz: server/lib/agent-busy.mjs başındaki not.)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(700);
      const { state } = await probe(session);
      if (state === BUSY) break;
      try {
        const { stdout } = await exec("tmux", ["capture-pane", "-t", session, "-p"]);
        const pane = typeof stdout === "string" ? stdout : "";
        if (!pane.includes("talimat dosyanı oku")) break;
        await exec("tmux", ["send-keys", "-t", session, "Enter"]);
      } catch {
        break;
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`${label} tmux oturumu başlatılamadı: ${detail}`);
    wrapped.cause = error;
    throw wrapped;
  }
}
