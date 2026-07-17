import { promises as fs } from "node:fs";
import path from "node:path";

function finiteToken(value) {
  const number = typeof value === "string" ? Number(value.replaceAll(",", "")) : value;
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined;
}

export function estimatedUsage(charsIn = 0, charsOut = 0) {
  return {
    tokens_in: Math.ceil(Math.max(0, charsIn) / 4),
    tokens_out: Math.ceil(Math.max(0, charsOut) / 4),
    chars: Math.max(0, charsIn) + Math.max(0, charsOut),
    estimated: true,
  };
}

export function codexTokenUsage(output) {
  const text = String(output ?? "");
  const paired = /tokens used\s*[:=]?\s*([\d,]+)(?:\s*(?:in|input))?\s*[,/]?\s*([\d,]+)?/iu.exec(text);
  if (!paired) return null;
  const first = finiteToken(paired[1]);
  const second = finiteToken(paired[2]);
  return second === undefined
    ? { tokens_out: first, estimated: false }
    : { tokens_in: first, tokens_out: second, estimated: false };
}

export function claudeStreamResult(output) {
  const source = String(output ?? "");
  const lines = source.split(/\r?\n/).filter(Boolean);
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let foundUsage = false;
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "result" && typeof event.result === "string") text = event.result;
    const usage = event.usage ?? event.message?.usage;
    const input = finiteToken(usage?.input_tokens);
    const outputTokens = finiteToken(usage?.output_tokens);
    if (input !== undefined) {
      tokensIn = Math.max(tokensIn, input);
      foundUsage = true;
    }
    if (outputTokens !== undefined) {
      tokensOut = Math.max(tokensOut, outputTokens);
      foundUsage = true;
    }
  }
  return {
    text: text || source,
    usage: foundUsage
      ? { tokens_in: tokensIn, tokens_out: tokensOut, estimated: false }
      : null,
  };
}

export async function appendUsage(workspace, record, { fileSystem = fs } = {}) {
  const chars = Number.isFinite(record.chars) ? Math.max(0, Math.round(record.chars)) : 0;
  let usage = {
    tokens_in: finiteToken(record.tokens_in),
    tokens_out: finiteToken(record.tokens_out),
    estimated: record.estimated === true,
  };
  if (usage.tokens_in === undefined && usage.tokens_out === undefined) {
    usage = estimatedUsage(record.chars_in ?? 0, record.chars_out ?? chars);
  }
  const line = {
    ts: record.ts ?? new Date().toISOString(),
    user: record.user,
    agent: record.agent,
    kind: record.kind,
    ...(usage.tokens_in !== undefined ? { tokens_in: usage.tokens_in } : {}),
    ...(usage.tokens_out !== undefined ? { tokens_out: usage.tokens_out } : {}),
    chars: chars || (record.chars_in ?? 0) + (record.chars_out ?? 0),
    ...(usage.estimated ? { estimated: true } : {}),
  };
  const filePath = path.join(workspace.directory, "usage.jsonl");
  await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  await fileSystem.appendFile(filePath, `${JSON.stringify(line)}\n`, "utf8");
  return line;
}

export async function readUsage(workspace) {
  try {
    const source = await fs.readFile(path.join(workspace.directory, "usage.jsonl"), "utf8");
    return source.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`usage.jsonl:${index + 1}: geçersiz JSON: ${error.message}`);
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
