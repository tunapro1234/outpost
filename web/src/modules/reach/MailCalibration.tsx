import { useEffect, useRef, useState } from "react";
import { api } from "@/core/api";
import { relativeTime } from "@/core/format";
import type { Calibration } from "@/core/types";
import { IconAssistant, IconHistory, IconPlus } from "@/core/icons";
import {
  ChatHistory,
  Composer,
  MessageRow,
} from "@/modules/chat/ChatDrawer";
import { useChatEngine } from "@/modules/chat/useChatEngine";

interface Props {
  // Called after the voice file changes (a manual Save, or the mail agent
  // finishing a reply that may have rewritten it) so Reach can refetch drafts.
  onCalibrationChanged: () => void;
}

// SPEC-MAILCAL §4 — the Calibration tab. Left: the caller's "mail voice" file
// (view/edit + calibrated-at badge + Save). Right: a long conversation with the
// personal mail agent, which edits the same voice file as you agree on style.
export default function MailCalibration({ onCalibrationChanged }: Props) {
  return (
    <div className="cal">
      <p className="cal-lead">
        Talk to your mail writer — agree on style, it updates your voice file;
        older drafts get rewritten automatically.
      </p>
      <div className="cal-cols">
        <CalibrationFile onSaved={onCalibrationChanged} />
        <CalibrationChat onReplyComplete={onCalibrationChanged} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CalibrationFile({ onSaved }: { onSaved: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [calibratedAt, setCalibratedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .calibration()
      .then((c: Calibration | null) => {
        if (!alive) return;
        setContent(c?.content ?? "");
        setSavedContent(c?.content ?? "");
        setCalibratedAt(c?.calibrated_at ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = content !== savedContent;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const c = await api.saveCalibration(content);
      setSavedContent(c.content);
      setContent(c.content);
      setCalibratedAt(c.calibrated_at);
      onSaved();
    } catch (e) {
      setError((e as Error)?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const rel = relativeTime(calibratedAt);

  return (
    <section className="cal-file">
      <div className="cal-file-head">
        <div className="cal-file-title">
          <span className="cal-file-name">Your mail voice</span>
          {calibratedAt && rel ? (
            <span className="cal-badge" title={calibratedAt}>
              Calibrated {rel}
            </span>
          ) : (
            <span className="cal-badge muted">Not calibrated yet</span>
          )}
        </div>
        <button
          className="btn primary sm"
          disabled={!dirty || saving}
          onClick={save}
          title={dirty ? "Save your voice file" : "No unsaved changes"}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <textarea
        className="cal-editor"
        value={content}
        spellCheck={false}
        placeholder={
          loaded
            ? "Describe your voice — tone, greetings, sign-off, do's and don'ts. Or just talk it through with your mail writer on the right; it writes here for you."
            : "Loading…"
        }
        onChange={(e) => setContent(e.target.value)}
      />
      {error && <div className="cal-file-err">{error}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------

function CalibrationChat({
  onReplyComplete,
}: {
  onReplyComplete: () => void;
}) {
  const chat = useChatEngine({
    endpoint: "mailagent",
    ns: "mailcal",
    title: "Mail writer",
    onReplyComplete,
  });

  const didFocus = useRef(false);
  useEffect(() => {
    if (!didFocus.current) {
      didFocus.current = true;
      chat.inputRef.current?.focus();
    }
  }, [chat.inputRef]);

  return (
    <section className="cal-chat">
      <header className="cal-chat-head">
        <span className="cal-chat-brand">
          <span className="cal-chat-ico">
            <IconAssistant size={15} />
          </span>
          Mail writer
        </span>
        <div className="cal-chat-actions">
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
        {chat.empty ? (
          <div className="cp-empty">
            <div className="cp-empty-mark">
              <IconAssistant size={22} />
            </div>
            <div className="cp-empty-title">Calibrate your voice</div>
            <div className="cp-empty-sub">
              Tell your mail writer how you want to sound. As you agree on style
              it edits your voice file on the left — and re-drafts older mail.
            </div>
          </div>
        ) : (
          chat.messages.map((m, i) => (
            <MessageRow
              key={i}
              msg={m}
              streaming={
                chat.streaming &&
                i === chat.messages.length - 1 &&
                m.role === "assistant"
              }
            />
          ))
        )}
      </div>

      <Composer
        ref={chat.inputRef}
        value={chat.input}
        onChange={chat.setInput}
        onSend={() => chat.send(chat.input)}
        onStop={chat.stop}
        streaming={chat.streaming}
        placeholder="Talk to your mail writer…"
      />
    </section>
  );
}
