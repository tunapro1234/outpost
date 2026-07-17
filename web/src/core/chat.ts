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
    handlers.onError(`The assistant isn't responding right now (HTTP ${res.status}).`);
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
// Multi-thread local history. Each workspace+namespace holds a list of threads;
// every thread carries its own backend thread id (for server-side continuity),
// a title derived from its first user message, and the full message log.
export interface ChatThread {
  id: string; // local id — the history key
  title: string; // derived from the first user message
  updatedAt: number; // ms epoch — orders the list + drives relative time
  backendThreadId: string | null; // server thread_id, for conversation continuity
  messages: ChatMessage[];
}

export interface ChatState {
  threads: ChatThread[];
  activeId: string | null;
}

export interface ChatStore {
  load(): ChatState;
  save(state: ChatState): void;
  loadWidth(): number;
  saveWidth(w: number): void;
}

const SCHEMA_VERSION = 2;
const MAX_THREADS = 30;
const TITLE_MAX = 40;

function makeThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// A fresh, empty thread. Titled "New chat" until its first user message lands.
export function newThread(): ChatThread {
  return {
    id: makeThreadId(),
    title: "New chat",
    updatedAt: Date.now(),
    backendThreadId: null,
    messages: [],
  };
}

// Title = first user message, collapsed to a single line and clipped to ~40ch.
export function threadTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const t = first.content.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX).trimEnd() + "…" : t;
}

// Compact "5m ago" / "2h ago" / "3d ago" — falls back to a short date past a week.
export function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Namespace keys so distinct assistants keep separate history/threads/width.
export function makeChatStore(ns: string): ChatStore {
  const stateKey = () => `outpost.${ns}.state.${getWorkspace()}`;
  const widthKey = `outpost.${ns}.width`;
  // Legacy v1 keys (single conversation per workspace) — migrated on first load.
  const legacyThreadKey = () => `outpost.${ns}.thread.${getWorkspace()}`;
  const legacyMsgsKey = () => `outpost.${ns}.msgs.${getWorkspace()}`;

  return {
    load(): ChatState {
      try {
        const raw = localStorage.getItem(stateKey());
        if (raw) {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            parsed.v === SCHEMA_VERSION &&
            Array.isArray(parsed.threads)
          ) {
            const threads = (parsed.threads as ChatThread[]).filter(
              (t) => t && Array.isArray(t.messages)
            );
            const activeId =
              typeof parsed.activeId === "string" &&
              threads.some((t) => t.id === parsed.activeId)
                ? parsed.activeId
                : threads[0]?.id ?? null;
            return { threads, activeId };
          }
        }
      } catch {
        /* fall through to migration / empty */
      }
      // ---- migrate legacy single-thread data (v1) → one thread, no loss ----
      try {
        const rawMsgs = localStorage.getItem(legacyMsgsKey());
        const legacyMsgs = rawMsgs ? JSON.parse(rawMsgs) : null;
        if (Array.isArray(legacyMsgs) && legacyMsgs.length > 0) {
          const t = newThread();
          t.messages = legacyMsgs as ChatMessage[];
          t.title = threadTitle(t.messages);
          t.backendThreadId = localStorage.getItem(legacyThreadKey());
          return { threads: [t], activeId: t.id };
        }
      } catch {
        /* ignore malformed legacy data */
      }
      return { threads: [], activeId: null };
    },

    save(state: ChatState) {
      try {
        const active = state.activeId;
        // Drop stray empty threads (except the active one), strip transient
        // error notes, order newest-first, and cap the history at MAX_THREADS.
        const cleaned = state.threads
          .filter((t) => t.messages.length > 0 || t.id === active)
          .map((t) => ({
            ...t,
            messages: t.messages.filter((m) => m.role !== "error"),
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const kept = cleaned.slice(0, MAX_THREADS);
        if (active && !kept.some((t) => t.id === active)) {
          const act = cleaned.find((t) => t.id === active);
          if (act) kept.push(act);
        }
        localStorage.setItem(
          stateKey(),
          JSON.stringify({ v: SCHEMA_VERSION, activeId: active, threads: kept })
        );
      } catch {
        /* quota — ignore */
      }
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
