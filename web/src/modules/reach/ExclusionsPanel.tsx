import { useState } from "react";
import { relativeTime } from "@/core/format";
import type { ExclusionsState } from "./useExclusions";

interface Props {
  state: ExclusionsState;
  q: string; // shared Reach search term
  onOpenEntity: (id: string) => void;
}

// Reach → Exclusions tab. Lists companies removed from outreach (name, who,
// when, why) with an owner-only "Remove" override that re-includes them. Remove
// opens an inline confirm with an optional reason before firing.
export default function ExclusionsPanel({ state, q, onOpenEntity }: Props) {
  const { items, loading, owner, busyId, remove } = state;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const openConfirm = (id: string) => {
    setConfirmId(id);
    setReason("");
  };
  const closeConfirm = () => {
    setConfirmId(null);
    setReason("");
  };

  if (loading) {
    return <div className="ep-loading">Loading…</div>;
  }

  if (items === null) {
    return (
      <div className="empty-state">
        <div className="es-title">Exclusions coming online</div>
        <div className="es-sub">
          We can't reach the exclusions service just yet. Once it's live, every
          company you remove from outreach shows up here to review or bring back.
        </div>
      </div>
    );
  }

  const nq = q.trim().toLowerCase();
  const rows = nq
    ? items.filter((e) =>
        `${e.name} ${e.reason} ${e.by}`.toLowerCase().includes(nq)
      )
    : items;

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="es-title">
          {items.length === 0 ? "No excluded companies" : "No matches"}
        </div>
        <div className="es-sub">
          {items.length === 0
            ? "Reject a draft to exclude its company from outreach, and it lands here. You can always bring one back."
            : "No excluded company matches your search."}
        </div>
      </div>
    );
  }

  return (
    <div className="excl-list">
      {rows.map((e) => {
        const confirming = confirmId === e.company_id;
        const busy = busyId === e.company_id;
        return (
          <div
            key={e.company_id}
            className={`excl-row ${confirming ? "confirming" : ""}`}
          >
            <div className="excl-main">
              <div className="excl-top">
                <button
                  className="excl-name link-btn"
                  onClick={() => onOpenEntity(e.company_id)}
                >
                  {e.name}
                </button>
                <span className="excl-meta">
                  by <b>{e.by}</b>
                  {e.at && (
                    <>
                      {" · "}
                      <span title={new Date(e.at).toLocaleString()}>
                        {relativeTime(e.at)}
                      </span>
                    </>
                  )}
                </span>
              </div>
              {e.reason && <div className="excl-reason">{e.reason}</div>}
            </div>

            <div className="excl-action">
              <button
                className="btn ghost sm"
                disabled={!owner || busy}
                title={
                  owner
                    ? "Re-include in outreach"
                    : "Only the workspace owner can bring this company back"
                }
                onClick={() => (confirming ? closeConfirm() : openConfirm(e.company_id))}
              >
                Remove
              </button>
            </div>

            {confirming && (
              <div className="excl-confirm" role="group" aria-label="Confirm override">
                <div className="excl-confirm-msg">
                  <b>{e.name}</b> will re-enter outreach. Are you sure?
                </div>
                <input
                  className="np-input"
                  value={reason}
                  placeholder="Optional reason (recorded)…"
                  autoFocus
                  onChange={(ev) => setReason(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Escape") closeConfirm();
                  }}
                />
                <div className="excl-confirm-actions">
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={closeConfirm}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn primary sm"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await remove(e.company_id, reason);
                      if (ok) closeConfirm();
                    }}
                  >
                    {busy ? "Working…" : "Re-include"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
