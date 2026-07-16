import { useState } from "react";
import type { MailDraft } from "@/core/types";
import type { ApprovePayload } from "./useMailDrafts";

interface Props {
  draft: MailDraft;
  busy?: boolean;
  onApprove: (id: string, payload: ApprovePayload) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
  onOpenEntity?: (id: string) => void;
}

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
          onClick={() => void onReject(draft.id)}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
