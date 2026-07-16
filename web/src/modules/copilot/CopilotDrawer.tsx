import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { marked } from "marked";
import {
  COPILOT_SUGGESTIONS,
  clearConversation,
  loadMessages,
  loadThread,
  loadWidth,
  saveMessages,
  saveThread,
  saveWidth,
  streamCopilot,
  type CopilotMessage,
} from "@/core/copilot";
import { IconClose, IconCopilot, IconPlus, IconSend } from "@/core/icons";

marked.setOptions({ breaks: true });

interface Props {
  onClose: () => void;
}

export default function CopilotDrawer({ onClose }: Props) {
  const [messages, setMessages] = useState<CopilotMessage[]>(loadMessages);
  const [threadId, setThreadId] = useState<string | null>(loadThread);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [width, setWidth] = useState<number>(loadWidth);

  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  // Persist the message log (errors are stripped inside saveMessages).
  useEffect(() => saveMessages(messages), [messages]);
  useEffect(() => saveThread(threadId), [threadId]);

  // Focus the composer on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep pinned to the newest content while the user hasn't scrolled up.
  useLayoutEffect(() => {
    if (stickToBottom.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      stickToBottom.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setInput("");
      // user bubble + an empty assistant bubble to stream into
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ]);

      const appendToAssistant = (delta: string) =>
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = { ...next[i], content: next[i].content + delta };
              break;
            }
          }
          return next;
        });

      streamCopilot(trimmed, threadId, controller.signal, {
        onDelta: appendToAssistant,
        onError: (msg) =>
          setMessages((prev) => [...prev, { role: "error", content: msg }]),
        onDone: (tid) => {
          if (tid) setThreadId(tid);
          setStreaming(false);
          abortRef.current = null;
          // Drop a trailing empty assistant bubble (e.g. immediate error).
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && !last.content)
              return prev.slice(0, -1);
            return prev;
          });
        },
      }).catch((err) => {
        setStreaming(false);
        abortRef.current = null;
        if ((err as Error)?.name === "AbortError") {
          // User pressed Stop — mark the partial reply, keep what streamed.
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant" && !last.content)
              return next.slice(0, -1);
            return next;
          });
          return;
        }
        setMessages((prev) => [
          ...prev,
          { role: "error", content: "Connection to copilot failed." },
        ]);
      });
    },
    [streaming, threadId]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages([]);
    setThreadId(null);
    clearConversation();
    inputRef.current?.focus();
  }, []);

  // ---- width resize (left edge handle) ----
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const onMove = (ev: MouseEvent) => {
        const w = Math.min(560, Math.max(320, startW + (startX - ev.clientX)));
        setWidth(w);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setWidth((w) => {
          saveWidth(w);
          return w;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width]
  );

  const empty = messages.length === 0;

  return (
    <aside className="copilot-drawer" style={{ width }}>
      <div
        className="cp-resize"
        onMouseDown={startResize}
        title="Drag to resize"
      />

      <header className="cp-head">
        <span className="cp-brand">
          <span className="cp-brand-ico">
            <IconCopilot size={16} />
          </span>
          Copilot
        </span>
        <div className="cp-head-actions">
          <button
            className="cp-icon-btn"
            onClick={newChat}
            title="New chat"
            disabled={empty && !streaming}
          >
            <IconPlus size={15} />
          </button>
          <button className="cp-icon-btn" onClick={onClose} title="Close (⌘J)">
            <IconClose size={15} />
          </button>
        </div>
      </header>

      <div className="cp-body" ref={bodyRef} onScroll={onBodyScroll}>
        {empty ? (
          <CopilotEmpty onPick={send} />
        ) : (
          messages.map((m, i) => (
            <MessageRow
              key={i}
              msg={m}
              streaming={
                streaming &&
                i === messages.length - 1 &&
                m.role === "assistant"
              }
            />
          ))
        )}
      </div>

      <Composer
        ref={inputRef}
        value={input}
        onChange={setInput}
        onSend={() => send(input)}
        onStop={stop}
        streaming={streaming}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------

function CopilotEmpty({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="cp-empty">
      <div className="cp-empty-mark">
        <IconCopilot size={22} />
      </div>
      <div className="cp-empty-title">Ask about your workspace</div>
      <div className="cp-empty-sub">
        A calm operations assistant with the whole graph in view — people,
        organizations, and mail activity.
      </div>
      <div className="cp-chips">
        {COPILOT_SUGGESTIONS.map((q) => (
          <button key={q} className="cp-chip" onClick={() => onPick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({
  msg,
  streaming,
}: {
  msg: CopilotMessage;
  streaming: boolean;
}) {
  if (msg.role === "error") {
    return (
      <div className="cp-error" role="alert">
        {msg.content}
      </div>
    );
  }
  if (msg.role === "user") {
    return (
      <div className="cp-msg user">
        <div className="cp-bubble">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="cp-msg assistant">
      <div className="cp-bubble">
        {msg.content ? (
          <AssistantMarkdown text={msg.content} />
        ) : (
          <span className="cp-thinking">
            <span />
            <span />
            <span />
          </span>
        )}
        {streaming && msg.content && <span className="cp-caret" />}
      </div>
    </div>
  );
}

function AssistantMarkdown({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text) as string, [text]);
  return <div className="md cp-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------------------

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
}

const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer({ value, onChange, onSend, onStop, streaming }, ref) {
    // Auto-grow the textarea up to a ceiling.
    const localRef = ref as React.RefObject<HTMLTextAreaElement>;
    useLayoutEffect(() => {
      const el = localRef?.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = Math.min(140, el.scrollHeight) + "px";
    }, [value, localRef]);

    return (
      <div className="cp-composer">
        <textarea
          ref={ref}
          className="cp-input"
          value={value}
          rows={1}
          placeholder="Ask the copilot…"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!streaming) onSend();
            }
          }}
        />
        {streaming ? (
          <button className="cp-stop" onClick={onStop} title="Stop">
            <span className="cp-stop-glyph" />
            Stop
          </button>
        ) : (
          <button
            className="cp-send"
            onClick={onSend}
            disabled={!value.trim()}
            title="Send (Enter)"
          >
            <IconSend size={16} />
          </button>
        )}
      </div>
    );
  }
);
