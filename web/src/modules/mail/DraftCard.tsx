import { useEffect, useState } from "react";
import type { MailDraft, MailRejectKind, MailRejectPayload } from "@/core/types";
import { relativeTime } from "@/core/format";
import type { ApprovePayload } from "./useMailDrafts";

interface Props {
  draft: MailDraft;
  busy?: boolean;
  onApprove: (id: string, payload: ApprovePayload) => Promise<void>;
  onReject: (id: string, payload?: MailRejectPayload) => Promise<unknown>;
  onOpenEntity?: (id: string) => void;
}

// Quick reasons offered when rejecting a draft. The system learns from these,
// and "exclude-company" cascades to the company's other pending drafts.
const REJECT_CHIPS: { kind: MailRejectKind; label: string }[] = [
  { kind: "exclude-company", label: "Don't contact this org" },
  { kind: "know-person", label: "I know this person" },
  { kind: "wrong-person", label: "Wrong person" },
  { kind: "bad-content", label: "Draft isn't good" },
];

function followupLabel(stage: 0 | 1 | 2): string | null {
  if (stage === 1) return "Follow-up 1";
  if (stage === 2) return "Follow-up 2";
  return null;
}

/**
 * Full approval card for a single mail draft — used by both the Overview
 * "Mails awaiting approval" section and the Reach "Drafts" tab. Handles variant
 * switching, inline editing of the selected variant's subject/body, and the
 * approve / reject actions.
 */
export default function DraftCard({
  draft,
  busy,
  onApprove,
  onReject,
  onOpenEntity,
}: Props) {
  const [sel, setSel] = useState(0);
  const [editing, setEditing] = useState(false);
  // Reject reason panel: opens inline below the actions when Reject is clicked.
  const [rejecting, setRejecting] = useState(false);
  const [rejKind, setRejKind] = useState<MailRejectKind | null>(null);
  const [rejText, setRejText] = useState("");
  // Per-variant edits, keyed by index. Absent = untouched (send original).
  const [edits, setEdits] = useState<
    Record<number, { subject: string; body: string }>
  >({});

  const variant = draft.variants[sel] ?? draft.variants[0];
  if (!variant) return null;

  const edited = edits[sel];
  const subject = edited?.subject ?? variant.subject;
  const body = edited?.body ?? variant.body;
  const fu = followupLabel(draft.followup_stage);
  const draftedRel = relativeTime(draft.created_at);

  const setField = (field: "subject" | "body", value: string) => {
    setEdits((cur) => ({
      ...cur,
      [sel]: {
        subject: cur[sel]?.subject ?? variant.subject,
        body: cur[sel]?.body ?? variant.body,
        [field]: value,
      },
    }));
  };

  const approve = () => {
    const payload: ApprovePayload = { variant: sel };
    // Only send overrides when the selected variant was actually touched.
    if (edited) {
      if (edited.subject !== variant.subject) payload.subject = edited.subject;
      if (edited.body !== variant.body) payload.body = edited.body;
    }
    void onApprove(draft.id, payload);
  };

  const closeReject = () => {
    setRejecting(false);
    setRejKind(null);
    setRejText("");
  };

  const confirmReject = () => {
    const payload: MailRejectPayload = {};
    if (rejKind) payload.kind = rejKind;
    const text = rejText.trim();
    if (text) payload.text = text;
    // Fire and forget — the caller drops the card (and any cascade) on success.
    void onReject(
      draft.id,
      payload.kind || payload.text ? payload : undefined
    );
  };

  // Escape cancels the reject panel without rejecting.
  useEffect(() => {
    if (!rejecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeReject();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rejecting]);

  return (
    <div className="md-card">
      <div className="md-head">
        <div className="md-who">
          <span className="md-person">{draft.person.name}</span>
          <span className="md-at">·</span>
          {onOpenEntity && draft.company.id ? (
            <button
              className="md-company link-btn"
              onClick={() => onOpenEntity(draft.company.id)}
            >
              {draft.company.name}
            </button>
          ) : (
            <span className="md-company">{draft.company.name}</span>
          )}
        </div>
        <div className="md-head-right">
          {fu && <span className="md-fu">{fu}</span>}
          <span className="md-score" title="Queue score">
            {Math.round(draft.score)}
          </span>
        </div>
      </div>

      {(draftedRel || draft.author || draft.stale) && (
        <div className="md-provenance">
          {(draftedRel || draft.author) && (
            <span className="md-drafted">
              {draftedRel ? `drafted ${draftedRel}` : "drafted"}
              {draft.author ? ` · by ${draft.author}` : ""}
            </span>
          )}
          {draft.stale && (
            <span
              className="md-stale"
              title="This draft predates your latest calibration — it will be re-written automatically."
            >
              outdated — queued for rewrite
            </span>
          )}
        </div>
      )}

      {draft.reasons.length > 0 && (
        <ul className="md-reasons">
          {draft.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      {/* variant switcher */}
      <div className="md-variant-bar">
        <div className="seg md-variant-seg">
          {draft.variants.map((v, i) => (
            <button
              key={i}
              className={i === sel ? "on" : ""}
              onClick={() => {
                setSel(i);
                setEditing(false);
              }}
              title={v.tone}
            >
              {v.tone || `Variant ${i + 1}`}
            </button>
          ))}
        </div>
        <button
          className="md-edit-toggle"
          onClick={() => setEditing((e) => !e)}
          title={editing ? "Stop editing" : "Edit subject & body"}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {/* variant content */}
      <div className="md-variant">
        <div className="md-field">
          <span className="md-field-k">Subject</span>
          {editing ? (
            <textarea
              className="md-input md-subject-input"
              rows={1}
              value={subject}
              onChange={(e) => setField("subject", e.target.value)}
            />
          ) : (
            <div className="md-subject">{subject}</div>
          )}
        </div>

        <div className="md-field">
          <span className="md-field-k">Body</span>
          {editing ? (
            <textarea
              className="md-input md-body-input"
              rows={9}
              value={body}
              onChange={(e) => setField("body", e.target.value)}
            />
          ) : (
            <div className="md-body">{body}</div>
          )}
        </div>

        {variant.rationale && (
          <div className="md-rationale">
            <span className="md-field-k">Why this angle</span>
            <span className="md-rationale-text">{variant.rationale}</span>
          </div>
        )}
      </div>

      <div className="md-actions">
        <button
          className="btn primary"
          disabled={busy}
          onClick={approve}
          title="Approve selected variant (marks outbox-ready — not sent)"
        >
          {busy ? "Working…" : "Approve"}
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          aria-expanded={rejecting}
          onClick={() => (rejecting ? closeReject() : setRejecting(true))}
        >
          Reject
        </button>
      </div>

      {rejecting && (
        <div className="md-reject" role="group" aria-label="Reject reason">
          <div className="md-reject-head">
            Why are you rejecting this draft?
            <span className="md-reject-opt">optional</span>
          </div>
          <div className="md-reject-chips">
            {REJECT_CHIPS.map((c) => (
              <button
                key={c.kind}
                type="button"
                className={rejKind === c.kind ? "md-rchip on" : "md-rchip"}
                aria-pressed={rejKind === c.kind}
                onClick={() =>
                  setRejKind((k) => (k === c.kind ? null : c.kind))
                }
              >
                {c.label}
              </button>
            ))}
          </div>

          {rejKind === "exclude-company" && (
            <div className="md-reject-warn">
              ⚠ {draft.company.name} will be excluded from all future outreach;
              other pending drafts from it will also be rejected.
            </div>
          )}

          <textarea
            className="md-input md-reject-note"
            rows={2}
            value={rejText}
            placeholder="Optional note — the system learns from this"
            onChange={(e) => setRejText(e.target.value)}
          />

          <div className="md-reject-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={closeReject}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={confirmReject}
            >
              {busy ? "Working…" : "Confirm reject"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
