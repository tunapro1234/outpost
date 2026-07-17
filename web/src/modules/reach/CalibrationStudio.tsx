import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/core/api";
import { streamSSE } from "@/core/sse";
import { relativeTime } from "@/core/format";
import { trNormalize } from "@/core/normalize";
import type {
  Calibration,
  CalibrationSkill,
  EntityListItem,
  MailAgentModel,
} from "@/core/types";
import {
  IconAssistant,
  IconClose,
  IconHistory,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@/core/icons";
import { ChatHistory, Composer, MessageRow } from "@/modules/chat/ChatDrawer";
import { useChatEngine } from "@/modules/chat/useChatEngine";

interface Props {
  entities: EntityListItem[];
  onBack: () => void;
  // Fired after the voice file or a draft-with-feedback changes so the Mail
  // page can refetch drafts (older ones may now be stale).
  onCalibrationChanged: () => void;
}

// SPEC-MAILCAL §9–11 — the Calibration Studio. A calm, single-column workshop:
// pick a real person from the queue, have your mail agent write them a draft,
// score it and say what worked; the agent rewrites its voice file and drafts
// again. A narrow helper column carries your uploaded skills, the raw voice
// file, and (for chat-capable models) a foldable conversation.
export default function CalibrationStudio({
  entities,
  onBack,
  onCalibrationChanged,
}: Props) {
  // ---- shared calibration file state (badge + voice editor read it) ----
  const [cal, setCal] = useState<Calibration | null>(null);
  const reloadCal = () => {
    api.calibration().then((c) => c && setCal(c));
  };
  useEffect(() => {
    let alive = true;
    api.calibration().then((c) => {
      if (alive && c) setCal(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---- model config ----
  const [model, setModel] = useState<MailAgentModel>("claude-opus-4-8");
  const [modelLoaded, setModelLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    api.mailAgentConfig().then((c) => {
      if (!alive) return;
      if (c) setModel(c.model);
      setModelLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const gpt = model === "gpt-5.6-sol";

  const changeModel = async (m: MailAgentModel) => {
    const prev = model;
    setModel(m); // optimistic
    try {
      const c = await api.saveMailAgentConfig(m);
      setModel(c.model);
    } catch {
      setModel(prev); // roll back on failure
    }
  };

  // ---- target person ----
  const [person, setPerson] = useState<EntityListItem | null>(null);

  const relCal = relativeTime(cal?.calibrated_at);

  return (
    <div className="studio">
      <div className="studio-back">
        <button className="studio-back-btn" onClick={onBack}>
          ← Mail
        </button>
        <span className="studio-title">Calibration studio</span>
        <span className="studio-sub">
          Train your mail voice on real people — draft, rate, rewrite.
        </span>
      </div>

      {/* (a) top strip: person + model + calibrated badge */}
      <div className="studio-strip">
        <PersonPicker
          entities={entities}
          person={person}
          onPick={setPerson}
        />
        <ModelPicker
          model={model}
          loaded={modelLoaded}
          onChange={changeModel}
        />
        <div className="studio-calbadge">
          {cal?.calibrated_at && relCal ? (
            <span className="cal-badge" title={cal.calibrated_at}>
              Calibrated {relCal}
            </span>
          ) : (
            <span className="cal-badge muted">Not calibrated yet</span>
          )}
        </div>
      </div>

      {/* (b) main column + (c) helper column */}
      <div className="studio-body">
        <div className="studio-main">
          <DraftPanel
            person={person}
            onVoiceMaybeChanged={() => {
              reloadCal();
              onCalibrationChanged();
            }}
          />
        </div>
        <aside className="studio-aside">
          <SkillsPanel />
          <VoiceEditor
            cal={cal}
            onSaved={(c) => {
              setCal(c);
              onCalibrationChanged();
            }}
          />
          <ChatSection gpt={gpt} onReplyComplete={reloadCal} />
        </aside>
      </div>
    </div>
  );
}

// ===========================================================================
// (a) Person picker — search the queue, show the chosen person as a card.

function PersonPicker({
  entities,
  person,
  onPick,
}: {
  entities: EntityListItem[];
  person: EntityListItem | null;
  onPick: (e: EntityListItem | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pool = useMemo(() => {
    const hasMail = (m: string | null | undefined) => {
      const s = (m ?? "").trim();
      return s !== "" && s !== "-" && s !== "yok";
    };
    return entities
      .filter((e) => hasMail(e.mail))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [entities]);

  const matches = useMemo(() => {
    const nq = trNormalize(q);
    const base = nq
      ? pool.filter((e) =>
          trNormalize(
            `${e.name} ${e.connected_org ?? ""} ${e.city ?? ""} ${e.subtype ?? ""}`
          ).includes(nq)
        )
      : pool;
    return base.slice(0, 40);
  }, [pool, q]);

  if (person) {
    return (
      <div className="studio-person">
        <div className="sp-card">
          <div className="sp-info">
            <span className="sp-name">{person.name}</span>
            <span className="sp-org">
              {person.connected_org ?? person.subtype ?? "—"}
              {person.city ? ` · ${person.city}` : ""}
            </span>
          </div>
          <span className="sp-score" title="Priority score">
            {person.score ?? "—"}
          </span>
          <button
            className="sp-clear"
            onClick={() => onPick(null)}
            title="Choose someone else"
            aria-label="Clear selected person"
          >
            <IconClose size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-person picker" ref={ref}>
      <div className="sp-search">
        <IconSearch size={15} />
        <input
          value={q}
          placeholder="Pick a target from the queue…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && (
        <div className="sp-menu">
          {matches.length === 0 ? (
            <div className="sp-empty">No matching people with a mail address.</div>
          ) : (
            matches.map((e) => (
              <button
                key={e.id}
                className="sp-opt"
                onClick={() => {
                  onPick(e);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span className="sp-opt-name">{e.name}</span>
                <span className="sp-opt-meta">
                  {e.connected_org ?? e.subtype ?? ""}
                  {e.city ? ` · ${e.city}` : ""}
                </span>
                <span className="sp-opt-score">{e.score ?? "—"}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// (a) Model picker — three options + a one-line description.

const MODELS: {
  id: MailAgentModel;
  label: string;
  desc: string;
}[] = [
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    desc: "Best writing taste — the default.",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    desc: "Fast and capable.",
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6",
    desc: "No persistent memory — generation only, no chat.",
  },
];

function ModelPicker({
  model,
  loaded,
  onChange,
}: {
  model: MailAgentModel;
  loaded: boolean;
  onChange: (m: MailAgentModel) => void;
}) {
  const active = MODELS.find((m) => m.id === model) ?? MODELS[0];
  return (
    <div className="studio-model">
      <div className="sm-seg" role="group" aria-label="Mail agent model">
        {MODELS.map((m) => (
          <button
            key={m.id}
            className={m.id === model ? "on" : ""}
            disabled={!loaded}
            onClick={() => m.id !== model && onChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className={`sm-desc${model === "gpt-5.6-sol" ? " warn" : ""}`}>
        {active.desc}
      </div>
    </div>
  );
}

// ===========================================================================
// (b) Draft panel — write / stream a draft, then rate + rewrite.

function parseDraft(text: string): { subject: string | null; body: string } {
  const m = text.match(/^[ \t]*subject:[ \t]*(.*)$/im);
  if (m && m.index != null) {
    const subject = m[1].trim();
    const body = text.slice(m.index + m[0].length).replace(/^\s+/, "");
    return { subject, body };
  }
  return { subject: null, body: text };
}

function DraftPanel({
  person,
  onVoiceMaybeChanged,
}: {
  person: EntityListItem | null;
  onVoiceMaybeChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [started, setStarted] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [liked, setLiked] = useState("");
  const [disliked, setDisliked] = useState("");
  const [lockNote, setLockNote] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  // Reset the whole surface whenever the target person changes.
  const personId = person?.id ?? null;
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDraft("");
    setStarted(false);
    setStreaming(false);
    setError(null);
    setRating(0);
    setLiked("");
    setDisliked("");
    setLockNote(false);
  }, [personId]);

  const run = (feedback?: { rating: number; liked: string; disliked: string }) => {
    if (!person || streaming) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStarted(true);
    setStreaming(true);
    setDraft("");
    setError(null);
    if (!feedback) setLockNote(false);

    streamSSE(
      "/calibration/draft",
      { person_id: person.id, ...(feedback ? { feedback } : {}) },
      ctrl.signal,
      {
        onDelta: (t) => setDraft((prev) => prev + t),
        onError: (m) => setError(m),
        onDone: () => {
          setStreaming(false);
          abortRef.current = null;
          if (feedback) {
            // The agent may have updated the voice file before rewriting.
            onVoiceMaybeChanged();
            setLockNote(feedback.rating >= 4);
            setRating(0);
            setLiked("");
            setDisliked("");
          }
        },
      }
    ).catch((err) => {
      setStreaming(false);
      abortRef.current = null;
      if ((err as Error)?.name !== "AbortError")
        setError("The draft stream failed. Try again.");
    });
  };

  const { subject, body } = parseDraft(draft);
  const canFeedback = started && !streaming && !!draft && !error;

  if (!person) {
    return (
      <div className="draft-panel empty">
        <div className="draft-empty">
          <IconAssistant size={26} />
          <div className="draft-empty-title">Pick someone to calibrate on</div>
          <div className="draft-empty-sub">
            Choose a real person from the queue above. Your mail agent writes
            them a genuine draft; you rate it and it rewrites — tightening your
            voice with every round.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-panel">
      {!started ? (
        <div className="draft-cta">
          <button
            className="btn primary"
            onClick={() => run()}
            disabled={streaming}
          >
            Write draft for {person.name}
          </button>
          <span className="draft-cta-hint">
            One draft — no variant clutter. Rate it, and it rewrites.
          </span>
        </div>
      ) : (
        <>
          <div className="draft-doc">
            {subject != null && (
              <div className="draft-subject">
                <span className="draft-subject-k">Subject</span>
                <span className="draft-subject-v">{subject || "…"}</span>
              </div>
            )}
            <div className="draft-body">
              {body || (streaming ? "" : "—")}
              {streaming && <span className="cp-caret" />}
            </div>
          </div>

          {error && <div className="draft-err">{error}</div>}

          {lockNote && (
            <div className="draft-lock">
              Style locking in — voice file updated.
            </div>
          )}

          <div className="draft-fb">
            <div className="draft-fb-head">
              <span className="draft-fb-title">How did this land?</span>
              <div
                className="stars"
                onMouseLeave={() => setHoverRating(0)}
                role="radiogroup"
                aria-label="Rate this draft 1 to 5"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`star${(hoverRating || rating) >= n ? " on" : ""}`}
                    onMouseEnter={() => setHoverRating(n)}
                    onClick={() => setRating(n)}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    aria-checked={rating === n}
                    role="radio"
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <div className="draft-fb-grid">
              <label className="draft-fb-field">
                <span>What worked</span>
                <textarea
                  className="np-input"
                  rows={2}
                  value={liked}
                  placeholder="Tone, the opener, the ask…"
                  onChange={(e) => setLiked(e.target.value)}
                />
              </label>
              <label className="draft-fb-field">
                <span>What didn't</span>
                <textarea
                  className="np-input"
                  rows={2}
                  value={disliked}
                  placeholder="Too formal, too long, wrong hook…"
                  onChange={(e) => setDisliked(e.target.value)}
                />
              </label>
            </div>
            <div className="draft-fb-actions">
              <button
                className="btn primary sm"
                disabled={!canFeedback || rating === 0}
                onClick={() =>
                  run({ rating, liked: liked.trim(), disliked: disliked.trim() })
                }
                title={
                  rating === 0
                    ? "Give it a rating first"
                    : "Send feedback and rewrite the draft"
                }
              >
                Send feedback &amp; rewrite
              </button>
              <button
                className="btn ghost sm"
                disabled={streaming}
                onClick={() => run()}
                title="Discard feedback and draft fresh"
              >
                Redraft
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// (c) Skills panel — upload / preview / delete user md skill files.

const SKILL_NAME_RE = /^[a-z0-9-]+\.md$/;

function SkillsPanel() {
  const [skills, setSkills] = useState<CalibrationSkill[] | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.calibrationSkills().then((s) => setSkills(s));
  useEffect(() => {
    let alive = true;
    api.calibrationSkills().then((s) => alive && setSkills(s));
    return () => {
      alive = false;
    };
  }, []);

  const add = async () => {
    const name = newName.trim().toLowerCase();
    if (!SKILL_NAME_RE.test(name)) {
      setErr("Name must look like my-style.md (a–z, 0–9, hyphen).");
      return;
    }
    if (new Blob([newContent]).size > 64 * 1024) {
      setErr("Skill is over the 64 KB limit.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.saveCalibrationSkill(name, newContent);
      await load();
      setAdding(false);
      setNewName("");
      setNewContent("");
    } catch (e) {
      setErr((e as Error)?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteCalibrationSkill(name);
      if (openName === name) setOpenName(null);
      await load();
    } catch (e) {
      setErr((e as Error)?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="aside-card">
      <div className="aside-head">
        <span className="aside-title">Your skills</span>
        <button
          className="cp-icon-btn"
          onClick={() => {
            setAdding((a) => !a);
            setErr(null);
          }}
          title="Add a skill file"
          aria-pressed={adding}
        >
          <IconPlus size={15} />
        </button>
      </div>

      <div className="aside-hint">
        Markdown rules your writer follows — layered over the shared mail skills.
      </div>

      {adding && (
        <div className="skill-add">
          <input
            className="np-input sm"
            placeholder="my-style.md"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <textarea
            className="np-input"
            rows={4}
            placeholder="Paste your skill markdown…"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
          <div className="skill-add-actions">
            <button className="btn primary sm" disabled={busy} onClick={add}>
              {busy ? "Saving…" : "Save skill"}
            </button>
            <button
              className="btn ghost sm"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setErr(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {err && <div className="aside-err">{err}</div>}

      {skills === null ? (
        <div className="aside-empty">Skill uploads are not available yet.</div>
      ) : skills.length === 0 ? (
        <div className="aside-empty">No skills yet — add one to shape your voice.</div>
      ) : (
        <ul className="skill-list">
          {skills.map((s) => {
            const open = openName === s.name;
            return (
              <li key={s.name} className={`skill-item${open ? " open" : ""}`}>
                <div className="skill-row">
                  <button
                    className="skill-name"
                    onClick={() => setOpenName(open ? null : s.name)}
                    title={open ? "Hide" : "Preview"}
                  >
                    <span className="skill-caret">{open ? "▾" : "▸"}</span>
                    {s.name}
                  </button>
                  <button
                    className="skill-del"
                    onClick={() => remove(s.name)}
                    disabled={busy}
                    title="Delete skill"
                    aria-label={`Delete ${s.name}`}
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
                {open && <pre className="skill-preview">{s.content}</pre>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ===========================================================================
// (c) Voice editor — the raw voice file, compact.

function VoiceEditor({
  cal,
  onSaved,
}: {
  cal: Calibration | null;
  onSaved: (c: Calibration) => void;
}) {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sync editor when the file loads or is rewritten by the agent — but never
  // clobber unsaved local edits.
  useEffect(() => {
    if (cal && content === saved) {
      setContent(cal.content);
      setSaved(cal.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal?.content, cal?.calibrated_at]);

  const dirty = content !== saved;

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const c = await api.saveCalibration(content);
      setContent(c.content);
      setSaved(c.content);
      onSaved(c);
    } catch (e) {
      setErr((e as Error)?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="aside-card">
      <div className="aside-head">
        <span className="aside-title">Voice file</span>
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
        className="voice-editor"
        spellCheck={false}
        value={content}
        placeholder="Tone, greetings, sign-off, do's and don'ts. Feedback in the studio writes here for you."
        onChange={(e) => setContent(e.target.value)}
      />
      {err && <div className="aside-err">{err}</div>}
    </section>
  );
}

// ===========================================================================
// (c) Foldable mail-agent chat — hidden/warned when the model can't chat.

function ChatSection({
  gpt,
  onReplyComplete,
}: {
  gpt: boolean;
  onReplyComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const chat = useChatEngine({
    endpoint: "mailagent",
    ns: "mailcal",
    title: "Mail writer",
    onReplyComplete,
  });

  return (
    <section className={`aside-card chat-card${open ? " open" : ""}`}>
      <button
        className="aside-head as-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="aside-title">
          <IconAssistant size={14} /> Chat with your writer
        </span>
        <span className="as-caret">{open ? "▾" : "▸"}</span>
      </button>

      {open &&
        (gpt ? (
          <div className="aside-empty warn">
            The GPT model has no persistent chat — it only generates drafts.
            Switch to a Claude model to talk it through.
          </div>
        ) : (
          <div className="chat-embed">
            <div className="chat-embed-actions">
              <button
                className={`cp-icon-btn${chat.historyOpen ? " on" : ""}`}
                onClick={() => chat.setHistoryOpen((o) => !o)}
                title="Chat history"
                aria-pressed={chat.historyOpen}
              >
                <IconHistory size={14} />
              </button>
              <button
                className="cp-icon-btn"
                onClick={chat.newChat}
                title="New chat"
                disabled={chat.empty && !chat.streaming && !chat.historyOpen}
              >
                <IconPlus size={14} />
              </button>
            </div>

            {chat.historyOpen && (
              <ChatHistory
                history={chat.history}
                activeId={chat.activeId}
                onOpen={chat.openThread}
                onDelete={chat.deleteThread}
              />
            )}

            <div
              className="cp-body chat-embed-body"
              ref={chat.bodyRef}
              onScroll={chat.onBodyScroll}
            >
              {chat.empty ? (
                <div className="chat-embed-empty">
                  Talk your voice through — the agent edits your file as you agree.
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
          </div>
        ))}
    </section>
  );
}
