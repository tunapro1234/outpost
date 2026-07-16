// Copilot API — workspace-scoped assistant. Gated per-user on the server:
// GET /copilot/enabled tells us whether the current viewer may use it, and the
// button is hidden entirely when disabled. Streaming replies arrive over SSE
// from a POST body, so we read the response stream by hand (EventSource can't
// POST).
import { WORKSPACE } from "./api";

const BASE = `/api/ws/${WORKSPACE}`;
const MOCK = import.meta.env.VITE_MOCK === "1";

export type CopilotRole = "user" | "assistant" | "error";

export interface CopilotMessage {
  role: CopilotRole;
  content: string;
}

// Returns true only when the server says this viewer is allowed. Any failure
// (offline, 404, mock) degrades to "hidden" so non-owners never see the entry.
export async function copilotEnabled(): Promise<boolean> {
  if (MOCK) return false;
  try {
    const res = await fetch(`${BASE}/copilot/enabled`);
    if (!res.ok) return false;
    const body = (await res.json()) as { enabled?: boolean };
    return !!body?.enabled;
  } catch {
    return false;
  }
}

export interface CopilotHandlers {
  onDelta: (text: string) => void;
  onError: (message: string) => void;
  onDone: (threadId?: string) => void;
}

// Streams a reply. Resolves when the stream ends (done event or EOF). Aborting
// via the signal rejects with an AbortError, which the caller treats as a
// user-initiated stop (not an error).
export async function streamCopilot(
  message: string,
  threadId: string | null,
  signal: AbortSignal,
  handlers: CopilotHandlers
): Promise<void> {
  const res = await fetch(`${BASE}/copilot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      ...(threadId ? { thread_id: threadId } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    handlers.onError(`Copilot is unavailable (HTTP ${res.status}).`);
    handlers.onDone();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneThread: string | undefined;

  const flushLine = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let obj: {
      delta?: string;
      error?: string;
      done?: boolean;
      thread_id?: string;
    };
    try {
      obj = JSON.parse(payload);
    } catch {
      return; // skip malformed/partial frames
    }
    if (obj.delta) handlers.onDelta(obj.delta);
    else if (obj.error) handlers.onError(obj.error);
    else if (obj.done) doneThread = obj.thread_id;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      flushLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer) flushLine(buffer);
  handlers.onDone(doneThread);
}

// ---- per-workspace persistence -----------------------------------------
const THREAD_KEY = `outpost.copilot.thread.${WORKSPACE}`;
const MSGS_KEY = `outpost.copilot.msgs.${WORKSPACE}`;
const WIDTH_KEY = "outpost.copilot.width";

export function loadThread(): string | null {
  return localStorage.getItem(THREAD_KEY);
}
export function saveThread(id: string | null): void {
  if (id) localStorage.setItem(THREAD_KEY, id);
  else localStorage.removeItem(THREAD_KEY);
}
export function loadMessages(): CopilotMessage[] {
  try {
    const raw = localStorage.getItem(MSGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CopilotMessage[]) : [];
  } catch {
    return [];
  }
}
export function saveMessages(msgs: CopilotMessage[]): void {
  try {
    // Never persist the error notes — they are transient session feedback.
    localStorage.setItem(
      MSGS_KEY,
      JSON.stringify(msgs.filter((m) => m.role !== "error"))
    );
  } catch {
    /* quota — ignore */
  }
}
export function clearConversation(): void {
  localStorage.removeItem(MSGS_KEY);
  localStorage.removeItem(THREAD_KEY);
}

export function loadWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  if (!raw || Number.isNaN(raw)) return 400;
  return Math.min(560, Math.max(320, raw));
}
export function saveWidth(w: number): void {
  localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
}

export const COPILOT_SUGGESTIONS: string[] = [
  "How many companies have no email?",
  "Summarize this workspace",
  "Who replied recently?",
];
