import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { StringDecoder } from "node:string_decoder";

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  busyPollMs: 2_000,
  busyWaitMs: 20_000,
  outboxPollMs: 500,
  timeoutMs: 180_000,
};

function defaultSleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error("Copilot isteği iptal edildi");
      error.name = "AbortError";
      reject(error);
      return;
    }

    const timer = setTimeout(finish, milliseconds);
    timer.unref?.();
    const abort = () => {
      clearTimeout(timer);
      const error = new Error("Copilot isteği iptal edildi");
      error.name = "AbortError";
      reject(error);
    };
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Copilot isteği iptal edildi");
  error.name = "AbortError";
  throw error;
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

function lastFiveLines(value) {
  const lines = String(value ?? "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-5).join("\n");
}

function commandFor(id) {
  return `[copilot ${id}] Soru: copilot/inbox/${id}.md oku; cevabı copilot/outbox/${id}.md dosyasına markdown olarak yaz; bitince copilot/outbox/${id}.done oluştur.`;
}

export function createTmuxBridge({
  exec = execFileAsync,
  fileSystem = fs,
  sleep = defaultSleep,
  now = Date.now,
  idFactory = () => `cp-${now()}-${randomBytes(2).toString("hex")}`,
  session = process.env.OUTPOST_COPILOT_TMUX ?? "outpost-copilot",
  logger,
  busyPollMs = DEFAULTS.busyPollMs,
  busyWaitMs = DEFAULTS.busyWaitMs,
  outboxPollMs = DEFAULTS.outboxPollMs,
  timeoutMs = DEFAULTS.timeoutMs,
} = {}) {
  async function sessionExists() {
    try {
      await exec("tmux", ["has-session", "-t", session]);
      return true;
    } catch {
      return false;
    }
  }

  async function waitUntilIdle(signal) {
    const deadline = now() + busyWaitMs;
    while (true) {
      throwIfAborted(signal);
      const { stdout = "" } = await exec("tmux", ["capture-pane", "-p", "-t", session]);
      if (!lastFiveLines(stdout).includes("esc to interrupt")) return true;
      const remaining = deadline - now();
      if (remaining <= 0) return false;
      await sleep(Math.min(busyPollMs, remaining), signal);
    }
  }

  async function* streamOutput(outboxFile, doneFile, signal) {
    const deadline = now() + timeoutMs;
    let offset = 0;
    const decoder = new StringDecoder("utf8");

    while (true) {
      throwIfAborted(signal);
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
      if (remaining <= 0) {
        throw new Error("Copilot tmux yanıtı 180 saniyede zaman aşımına uğradı");
      }
      await sleep(Math.min(outboxPollMs, remaining), signal);
    }
  }

  return async function tryTmuxBridge(prompt, { signal, workspace } = {}) {
    if (!await sessionExists()) return null;
    throwIfAborted(signal);

    const id = idFactory();
    const copilotDirectory = path.join(workspace.directory, "copilot");
    const inboxDirectory = path.join(copilotDirectory, "inbox");
    const outboxDirectory = path.join(copilotDirectory, "outbox");
    const inboxFile = path.join(inboxDirectory, `${id}.md`);
    const outboxFile = path.join(outboxDirectory, `${id}.md`);
    const doneFile = path.join(outboxDirectory, `${id}.done`);

    await Promise.all([
      fileSystem.mkdir(inboxDirectory, { recursive: true }),
      fileSystem.mkdir(outboxDirectory, { recursive: true }),
    ]);
    await fileSystem.writeFile(inboxFile, prompt, "utf8");

    if (!await waitUntilIdle(signal)) {
      logger?.warn?.(
        { session, id },
        "Copilot tmux oturumu meşgul; headless runner kullanılacak",
      );
      return null;
    }

    await exec("tmux", ["send-keys", "-t", session, "-l", commandFor(id)]);
    await exec("tmux", ["send-keys", "-t", session, "Enter"]);
    return streamOutput(outboxFile, doneFile, signal);
  };
}
