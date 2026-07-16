import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const THREAD_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export function resolveThreadId(value) {
  if (value === undefined) return randomUUID();
  if (typeof value !== "string" || !THREAD_ID.test(value)) {
    const error = new Error("Geçersiz thread_id");
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function threadPath(workspace, threadId) {
  return path.join(workspace.directory, "copilot-threads", `${resolveThreadId(threadId)}.jsonl`);
}

export async function readThread(workspace, threadId, { limit = 10 } = {}) {
  let source;
  try {
    source = await fs.readFile(threadPath(workspace, threadId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const messages = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Copilot thread satırı ${index + 1} okunamadı: ${error.message}`);
    }
    if (
      !record ||
      typeof record !== "object" ||
      !["user", "assistant"].includes(record.role) ||
      typeof record.content !== "string"
    ) {
      throw new Error(`Copilot thread satırı ${index + 1} geçersiz`);
    }
    messages.push(record);
  }
  return messages.slice(-limit);
}

export async function appendThreadMessage(workspace, threadId, role, content) {
  if (!["user", "assistant"].includes(role)) throw new Error("Geçersiz thread rolü");
  const filePath = threadPath(workspace, threadId);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const record = {
    role,
    content: String(content),
    created_at: new Date().toISOString(),
  };
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return record;
}
