import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BRIEF_TEMPLATE = path.join(MODULE_DIRECTORY, "assistant-brief.md");

function defaultSleep(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

export function renderAssistantBrief(template, { user, workspaceId }) {
  return template
    .replaceAll("{{user}}", () => user)
    .replaceAll("{{ws}}", () => workspaceId);
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
  const brief = renderAssistantBrief(template, { user, workspaceId: workspace.id });
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

function spawnError(error) {
  const detail = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(`Asistan tmux oturumu başlatılamadı: ${detail}`);
  wrapped.cause = error;
  return wrapped;
}

export async function spawnAssistantSession({
  workspace,
  user,
  session = `outpost-user-${user}`,
  exec = execFileAsync,
  sleep = defaultSleep,
  spawnWaitMs = 1_000,
  claudeBin = process.env.OUTPOST_CLAUDE_BIN ?? "claude",
}) {
  // IS_SANDBOX=1: claude, root altında --dangerously-skip-permissions'ı ancak
  // bu bayrakla kabul ediyor (sunucudaki tüm tmux agent'larıyla aynı düzen).
  const command = `IS_SANDBOX=1 ${claudeBin} --dangerously-skip-permissions --model claude-sonnet-5`;
  try {
    await exec("tmux", [
      "new-session",
      "-d",
      "-s",
      session,
      "-c",
      workspace.directory,
      command,
    ]);
    // TUI hazır olmadan gönderilen tuşlar yutuluyor: prompt (❯) görünene
    // kadar bekle (en çok ~30 sn), sonra brief'i gönder.
    const deadline = Date.now() + Math.max(spawnWaitMs, 30_000);
    let ready = false;
    while (Date.now() < deadline) {
      await sleep(1_000);
      try {
        const { stdout } = await exec("tmux", ["capture-pane", "-t", session, "-p"]);
        if (typeof stdout === "string" && stdout.includes("❯")) {
          ready = true;
          break;
        }
      } catch {
        // pane henüz yoksa beklemeye devam
      }
    }
    if (!ready) throw new Error("claude TUI zamanında hazır olmadı");
    await exec("tmux", [
      "send-keys",
      "-t",
      session,
      "-l",
      "talimat dosyanı oku; protokol: [assist <id>] mesajları",
    ]);
    await exec("tmux", ["send-keys", "-t", session, "Enter"]);
    // vim-mode: ilk Enter submit etmeyebilir — agent çalışmaya başlamadıysa tekrarla.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sleep(700);
      try {
        const { stdout } = await exec("tmux", ["capture-pane", "-t", session, "-p"]);
        const pane = typeof stdout === "string" ? stdout : "";
        if (pane.includes("esc to interrupt")) break;
        if (!pane.includes("talimat dosyanı oku")) break;
        await exec("tmux", ["send-keys", "-t", session, "Enter"]);
      } catch {
        break;
      }
    }
  } catch (error) {
    throw spawnError(error);
  }
}

export { defaultSleep as assistantSleep, execFileAsync as assistantExec };
