// Shared chat engine for the workspace-scoped assistants — Copilot (owner) and
// the personal Assistant (every user). Both stream SSE replies from a POST body
// in the same frame format, and persist their conversation per workspace under
// distinct namespaces. Endpoint-specific concerns (title, gating, empty state)
// live in the thin drawer wrappers; this module is the shared plumbing.
import { getWorkspace, workspaceBase } from "./api";

export type ChatRole = "user" | "assistant" | "error";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatHandlers {
  onDelta: (text: string) => void;
  onError: (message: string) => void;
  onDone: (threadId?: string) => void;
}

// Streams a reply from a workspace-relative endpoint (e.g. "copilot" or
// "assistant"). Resolves when the stream ends (done event or EOF). Aborting via
// the signal rejects with an AbortError, which the caller treats as a
// user-initiated stop (not an error).
export async function streamChat(
  endpoint: string,
  message: string,
  threadId: string | null,
  signal: AbortSignal,
  handlers: ChatHandlers
): Promise<void> {
  const res = await fetch(`${workspaceBase()}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      ...(threadId ? { thread_id: threadId } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    handlers.onError(`Assistant is unavailable (HTTP ${res.status}).`);
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

// ---- per-workspace persistence, namespaced per assistant ----------------
export interface ChatStore {
  loadThread(): string | null;
  saveThread(id: string | null): void;
  loadMessages(): ChatMessage[];
  saveMessages(msgs: ChatMessage[]): void;
  clearConversation(): void;
  loadWidth(): number;
  saveWidth(w: number): void;
}

// Namespace keys so Copilot and Assistant keep separate history/threads/width.
// Keeping ns "copilot" preserves the existing owner conversation keys.
export function makeChatStore(ns: string): ChatStore {
  const threadKey = () => `outpost.${ns}.thread.${getWorkspace()}`;
  const messagesKey = () => `outpost.${ns}.msgs.${getWorkspace()}`;
  const widthKey = `outpost.${ns}.width`;

  return {
    loadThread() {
      return localStorage.getItem(threadKey());
    },
    saveThread(id) {
      if (id) localStorage.setItem(threadKey(), id);
      else localStorage.removeItem(threadKey());
    },
    loadMessages() {
      try {
        const raw = localStorage.getItem(messagesKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
      } catch {
        return [];
      }
    },
    saveMessages(msgs) {
      try {
        // Never persist the error notes — they are transient session feedback.
        localStorage.setItem(
          messagesKey(),
          JSON.stringify(msgs.filter((m) => m.role !== "error"))
        );
      } catch {
        /* quota — ignore */
      }
    },
    clearConversation() {
      localStorage.removeItem(messagesKey());
      localStorage.removeItem(threadKey());
    },
    loadWidth() {
      const raw = Number(localStorage.getItem(widthKey));
      if (!raw || Number.isNaN(raw)) return 400;
      return Math.min(560, Math.max(320, raw));
    },
    saveWidth(w) {
      localStorage.setItem(widthKey, String(Math.round(w)));
    },
  };
}
