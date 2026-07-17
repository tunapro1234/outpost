// Minimal SSE-over-POST reader shared by the streaming surfaces that don't go
// through the chat engine — notably the Calibration studio's draft stream
// (POST /calibration/draft). Same frame format as core/chat.ts: newline-
// delimited `data: {json}` lines. Frames carry any of:
//   { phase: "feedback" | "context" | "writing" }  — stage changes
//   { delta: "..." }                                 — live token stream
//   { done: true, draft?: { subject, body, rationale } } — final structure
//   { error: "...", phase?: "..." }                  — failure
// Older servers may send a bare { done: true } with no draft, or stream only
// deltas and no phases — the reader stays backward-compatible with both.
import { workspaceBase } from "./api";

export type DraftPhase = "feedback" | "context" | "writing" | "voice";

export interface StructuredDraft {
  subject?: string | null;
  body?: string | null;
  rationale?: string | null;
}

export interface SSEHandlers {
  onDelta: (text: string) => void;
  onError: (message: string, phase?: DraftPhase) => void;
  onDone: (draft?: StructuredDraft) => void;
  // Optional — only newer servers emit phase frames.
  onPhase?: (phase: DraftPhase) => void;
}

// POSTs `body` to a workspace-relative path and streams the reply. Resolves
// when the stream ends. Aborting via the signal rejects with an AbortError,
// which the caller treats as a user-initiated stop (not an error).
export async function streamSSE(
  path: string,
  body: unknown,
  signal: AbortSignal,
  handlers: SSEHandlers
): Promise<void> {
  const res = await fetch(`${workspaceBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let msg = `We couldn't generate that just now (HTTP ${res.status}).`;
    if (res.status === 404) msg = "This isn't wired up on the server yet.";
    if (res.status === 409)
      msg = "This model can't handle that. Switch models to keep going.";
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore non-JSON bodies */
    }
    handlers.onError(msg);
    handlers.onDone();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A structured { done: true, draft } frame, if the server sends one — handed
  // to onDone once the stream closes so the caller can settle the final shape.
  let finalDraft: StructuredDraft | undefined;

  const flushLine = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    let obj: {
      phase?: DraftPhase;
      delta?: string;
      error?: string;
      done?: boolean;
      draft?: StructuredDraft;
    };
    try {
      obj = JSON.parse(payload);
    } catch {
      return; // skip malformed/partial frames
    }
    if (obj.error) handlers.onError(obj.error, obj.phase);
    else if (obj.done) {
      if (obj.draft) finalDraft = obj.draft;
    } else if (obj.delta) handlers.onDelta(obj.delta);
    else if (obj.phase) handlers.onPhase?.(obj.phase);
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
  handlers.onDone(finalDraft);
}
