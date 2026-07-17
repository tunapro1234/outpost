import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  busyPollMs: 2_000,
  busyWaitMs: 20_000,
  outboxPollMs: 500,
  timeoutMs: 180_000,
};
let bridgeQueue = Promise.resolve();

async function acquireBridge() {
  const previous = bridgeQueue;
  let release;
  bridgeQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  return release;
}

function abortError(label) {
  const error = new Error(`${label} isteği iptal edildi`);
  error.name = "AbortError";
  return error;
}

function defaultSleep(milliseconds, signal, label) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(label));
      return;
    }

    const timer = setTimeout(finish, milliseconds);
    timer.unref?.();
    const abort = () => {
      clearTimeout(timer);
      reject(abortError(label));
    };
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal, label) {
  if (signal?.aborted) throw abortError(label);
}

async function exists(file, fileSystem) {
  try {
    await fileSystem.access(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readOutput(file, fileSystem) {
  try {
    return await fileSystem.readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return Buffer.alloc(0);
    throw error;
  }
}

async function removeIfPresent(file, fileSystem) {
  try {
    await fileSystem.unlink(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function secureDirectory(directory, fileSystem) {
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  await fileSystem.chmod(directory, 0o700);
}

function lastFiveLines(value) {
  const lines = String(value ?? "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-5).join("\n");
}

export function createTmuxFileBridge({
  exec = execFileAsync,
  fileSystem = fs,
  sleep,
  now = Date.now,
  idFactory = () => `tmux-${now()}-${randomBytes(2).toString("hex")}`,
  session,
  label = "Tmux",
  resolveDirectory,
  commandFor,
  onMissingSession,
  logger,
  busyMessage,
  busyPollMs = DEFAULTS.busyPollMs,
  busyWaitMs = DEFAULTS.busyWaitMs,
  outboxPollMs = DEFAULTS.outboxPollMs,
  timeoutMs = DEFAULTS.timeoutMs,
  timeoutMessage = `${label} tmux yanıtı ${timeoutMs / 1_000} saniyede zaman aşımına uğradı`,
} = {}) {
  if (!session) throw new Error("Tmux session adı zorunlu");
  if (typeof resolveDirectory !== "function") {
    throw new Error("Tmux dosya dizini çözücüsü zorunlu");
  }
  if (typeof commandFor !== "function") throw new Error("Tmux komut üreticisi zorunlu");
  const wait = sleep ?? ((milliseconds, signal) => defaultSleep(milliseconds, signal, label));

  async function sessionExists(context) {
    try {
      await exec("tmux", ["has-session", "-t", `=${session}`]);
      return true;
    } catch {
      if (!onMissingSession) return false;
      await onMissingSession({ ...context, session, exec });
      return true;
    }
  }

  async function waitUntilIdle(signal) {
    const deadline = now() + busyWaitMs;
    while (true) {
      throwIfAborted(signal, label);
      const { stdout = "" } = await exec("tmux", ["capture-pane", "-p", "-t", session]);
      if (!lastFiveLines(stdout).includes("esc to interrupt")) return true;
      const remaining = deadline - now();
      if (remaining <= 0) return false;
      await wait(Math.min(busyPollMs, remaining), signal);
    }
  }

  async function* streamOutput(outboxFile, doneFile, signal) {
    const deadline = now() + timeoutMs;
    let offset = 0;
    const decoder = new StringDecoder("utf8");

    while (true) {
      throwIfAborted(signal, label);
      const output = await readOutput(outboxFile, fileSystem);
      if (output.length < offset) {
        offset = 0;
        decoder.end();
      }
      if (output.length > offset) {
        const delta = decoder.write(output.subarray(offset));
        offset = output.length;
        if (delta) yield delta;
      }

      if (await exists(doneFile, fileSystem)) {
        const finalOutput = await readOutput(outboxFile, fileSystem);
        if (finalOutput.length > offset) {
          const delta = decoder.write(finalOutput.subarray(offset));
          offset = finalOutput.length;
          if (delta) yield delta;
        }
        const finalDelta = decoder.end();
        if (finalDelta) yield finalDelta;
        return;
      }

      const remaining = deadline - now();
      if (remaining <= 0) throw new Error(timeoutMessage);
      await wait(Math.min(outboxPollMs, remaining), signal);
    }
  }

  return async function tryTmuxBridge(prompt, context = {}) {
    if (!await sessionExists(context)) return null;
    const { signal } = context;
    throwIfAborted(signal, label);

    const release = await acquireBridge();
    let streamOwnsCleanup = false;
    let cleanup = async () => {};

    try {
      const id = idFactory();
      const { absolute, relative } = resolveDirectory(context);
      const inboxDirectory = path.join(absolute, "inbox");
      const outboxDirectory = path.join(absolute, "outbox");
      const inboxFile = path.join(inboxDirectory, `${id}.md`);
      const outboxFile = path.join(outboxDirectory, `${id}.md`);
      const doneFile = path.join(outboxDirectory, `${id}.done`);

      cleanup = async () => {
        await Promise.all([
          removeIfPresent(inboxFile, fileSystem),
          removeIfPresent(outboxFile, fileSystem),
          removeIfPresent(doneFile, fileSystem),
        ]);
      };

      await secureDirectory(absolute, fileSystem);
      await Promise.all([
        secureDirectory(inboxDirectory, fileSystem),
        secureDirectory(outboxDirectory, fileSystem),
      ]);
      await fileSystem.writeFile(inboxFile, prompt, { encoding: "utf8", mode: 0o600 });

      if (!await waitUntilIdle(signal)) {
        logger?.warn?.({ session, id }, busyMessage ?? `${label} tmux oturumu meşgul`);
        return null;
      }

      const commandLine = commandFor(id, relative);
      await exec("tmux", ["send-keys", "-t", session, "-l", commandLine]);
      await exec("tmux", ["send-keys", "-t", session, "Enter"]);
      // vim-mode composer'da ilk Enter satır ekleyebiliyor (submit etmiyor).
      // Agent çalışmaya başlamadıysa ("esc to interrupt" yoksa) ve mesaj hâlâ
      // ekrandaysa Enter'ı tekrarla (en çok 3 kez).
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        try {
          const { stdout } = await exec("tmux", ["capture-pane", "-p", "-t", session]);
          const pane = typeof stdout === "string" ? stdout : "";
          if (pane.includes("esc to interrupt")) break; // submit oldu, agent çalışıyor
          if (!pane.includes(id)) break;
          await exec("tmux", ["send-keys", "-t", session, "Enter"]);
        } catch {
          break;
        }
      }
      streamOwnsCleanup = true;
      const output = streamOutput(outboxFile, doneFile, signal);
      return (async function* queuedOutput() {
        try {
          yield* output;
        } finally {
          try {
            await cleanup();
          } finally {
            release();
          }
        }
      })();
    } finally {
      if (!streamOwnsCleanup) {
        try {
          await cleanup();
        } finally {
          release();
        }
      }
    }
  };
}
