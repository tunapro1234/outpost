import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { relativeTime, type ChatMessage } from "@/core/chat";
import { useChatEngine } from "./useChatEngine";
import {
  IconClose,
  IconHistory,
  IconPlus,
  IconSend,
  IconTrash,
} from "@/core/icons";
import { renderMarkdown } from "@/core/markdown";

export interface ChatDrawerProps {
  // Header
  title: string;
  icon: ReactNode;
  // Wiring
  endpoint: string; // workspace-relative, e.g. "copilot" | "assistant"
  ns: string; // persistence namespace, e.g. "copilot" | "assistant"
  placeholder: string;
  closeTitle?: string;
  // Empty-state renderer (gets a `send` so suggestion chips can dispatch).
  renderEmpty: (send: (q: string) => void) => ReactNode;
  // Optional message to auto-send when it becomes non-null (from the Overview
  // prompt bar). The caller clears it via onSeedConsumed once dispatched.
  seed?: string | null;
  onSeedConsumed?: () => void;
  // Fired when a reply finishes streaming — the Assistant uses it to refetch
  // the dashboard, which the agent may have just rearranged.
  onReplyComplete?: (threadId?: string) => void;
  // Reports the drawer's live width (initial + during resize) so the shell can
  // squeeze the main content by the same amount.
  onWidth?: (w: number) => void;
  onClose: () => void;
}

export default function ChatDrawer({
  title,
  icon,
  endpoint,
  ns,
  placeholder,
  closeTitle,
  renderEmpty,
  seed,
  onSeedConsumed,
  onReplyComplete,
  onWidth,
  onClose,
}: ChatDrawerProps) {
  const chat = useChatEngine({
    endpoint,
    ns,
    title,
    seed,
    onSeedConsumed,
    onReplyComplete,
  });

  const [width, setWidth] = useState<number>(chat.store.loadWidth);

  // Report width up so the shell can squeeze content in sync with resizing.
  useEffect(() => onWidth?.(width), [width, onWidth]);

  // Focus the composer on open.
  useEffect(() => {
    chat.inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          chat.store.saveWidth(w);
          return w;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, chat.store]
  );

  return (
    <aside className="copilot-drawer" style={{ width }}>
      <div
        className="cp-resize"
        onMouseDown={startResize}
        title="Drag to resize"
      />

      <header className="cp-head">
        <span className="cp-brand">
          <span className="cp-brand-ico">{icon}</span>
          {title}
        </span>
        <div className="cp-head-actions">
          <button
            className={`cp-icon-btn${chat.historyOpen ? " on" : ""}`}
            onClick={() => chat.setHistoryOpen((o) => !o)}
            title="Chat history"
            aria-pressed={chat.historyOpen}
          >
            <IconHistory size={15} />
          </button>
          <button
            className="cp-icon-btn"
            onClick={chat.newChat}
            title="New chat"
            disabled={chat.empty && !chat.streaming && !chat.historyOpen}
          >
            <IconPlus size={15} />
          </button>
          <button
            className="cp-icon-btn"
            onClick={onClose}
            title={closeTitle ?? "Close"}
          >
            <IconClose size={15} />
          </button>
        </div>
      </header>

      {chat.historyOpen && (
        <ChatHistory
          history={chat.history}
          activeId={chat.activeId}
          onOpen={chat.openThread}
          onDelete={chat.deleteThread}
        />
      )}

      <div className="cp-body" ref={chat.bodyRef} onScroll={chat.onBodyScroll}>
        {chat.empty
          ? renderEmpty(chat.send)
          : chat.messages.map((m, i) => (
              <MessageRow
                key={i}
                msg={m}
                streaming={
                  chat.streaming &&
                  i === chat.messages.length - 1 &&
                  m.role === "assistant"
                }
              />
            ))}
      </div>

      <Composer
        ref={chat.inputRef}
        value={chat.input}
        onChange={chat.setInput}
        onSend={() => chat.send(chat.input)}
        onStop={chat.stop}
        streaming={chat.streaming}
        placeholder={placeholder}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Shared conversation-history dropdown — reused by every chat surface.

export function ChatHistory({
  history,
  activeId,
  onOpen,
  onDelete,
}: {
  history: { id: string; title: string; updatedAt: number }[];
  activeId: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="cp-history">
      <div className="cp-history-head">
        <span className="cp-history-label">Chat history</span>
      </div>
      <div className="cp-history-list">
        {history.length === 0 ? (
          <div className="cp-history-empty">No past conversations yet.</div>
        ) : (
          history.map((t) => (
            <div
              key={t.id}
              className={`cp-history-item${t.id === activeId ? " active" : ""}`}
            >
              <button
                className="cp-history-open"
                onClick={() => onOpen(t.id)}
                title={t.title}
              >
                <span className="cp-history-title">{t.title}</span>
                <span className="cp-history-time">
                  {relativeTime(t.updatedAt)}
                </span>
              </button>
              <button
                className="cp-history-del"
                onClick={() => onDelete(t.id)}
                title="Delete conversation"
                aria-label="Delete conversation"
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MessageRow({
  msg,
  streaming,
}: {
  msg: ChatMessage;
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
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="md cp-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------------------

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer(
    { value, onChange, onSend, onStop, streaming, placeholder },
    ref
  ) {
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
          placeholder={placeholder}
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
