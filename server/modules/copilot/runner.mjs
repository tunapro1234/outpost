import { spawn } from "node:child_process";
import readline from "node:readline";
import { redactSecrets } from "./context.mjs";

const MAX_STDERR = 16_000;

export const CLAUDE_ARGS = [
  "--model", process.env.OUTPOST_COPILOT_MODEL ?? "claude-opus-4-8",
  "--safe-mode",
  "--disable-slash-commands",
  "--disallowedTools", "*",
  "--no-session-persistence",
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
];

function jsonDelta(record, state) {
  const streamDelta = record?.event?.delta?.text ??
    (record?.type === "content_block_delta" ? record.delta?.text : undefined);
  if (typeof streamDelta === "string") {
    state.partial = true;
    return streamDelta;
  }
  if (record?.type === "assistant" && !state.partial) {
    const text = record.message?.content
      ?.filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
    if (text) return text;
  }
  if (record?.type === "result" && !state.partial && !state.emitted) {
    return typeof record.result === "string" ? record.result : null;
  }
  return null;
}

function runnerError(result, stderr) {
  if (result.error?.code === "ENOENT") return new Error("Claude CLI kurulu değil");
  if (result.error) return new Error(`Claude CLI başlatılamadı: ${result.error.message}`);
  const detail = redactSecrets(stderr).replace(/\s+/g, " ").trim().slice(-800);
  return new Error(
    `Claude CLI başarısız (${result.code ?? result.signal ?? "bilinmeyen"})${detail ? `: ${detail}` : ""}`,
  );
}

export async function* runClaude(prompt, {
  signal,
  workspace,
  timeoutMs = 120_000,
} = {}) {
  const child = spawn(process.env.OUTPOST_CLAUDE_BIN ?? "claude", CLAUDE_ARGS, {
    cwd: workspace?.directory ?? process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    if (stderr.length < MAX_STDERR) stderr += chunk.toString("utf8");
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref?.();
  const abort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });

  const completed = new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => finish({ error }));
    child.once("close", (code, closedSignal) => finish({ code, signal: closedSignal }));
  });

  const state = { partial: false, emitted: false };
  try {
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let delta;
      try {
        delta = jsonDelta(JSON.parse(line), state);
      } catch {
        delta = `${line}\n`;
      }
      if (delta) {
        state.emitted = true;
        yield delta;
      }
    }
    const result = await completed;
    if (signal?.aborted) {
      const error = new Error("Copilot isteği iptal edildi");
      error.name = "AbortError";
      throw error;
    }
    if (timedOut) throw new Error("Claude CLI 120 saniyede zaman aşımına uğradı");
    if (result.error || result.code !== 0) throw runnerError(result, stderr);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}
