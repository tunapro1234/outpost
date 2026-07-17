import { useEffect, useState } from "react";
import type { EntityMeta, EntityType } from "@/core/types";
import { api } from "@/core/api";
import { isOwner } from "@/core/viewer";
import { relativeTime } from "@/core/format";

const ORG_TYPES = new Set<EntityType>([
  "company",
  "institution",
  "school",
  "channel",
]);

interface Resolved {
  by: string;
  at: string;
  reason: string;
}

interface Props {
  id: string;
  name: string;
  type: EntityType;
  meta: EntityMeta;
  onRemoved?: () => void;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Amber banner shown on an excluded company's full page. Prefers the exclusion
// meta carried on the /entities response; if absent, falls back to matching the
// entity id against GET /exclusions (org-like types only). The owner can
// override (re-include) inline.
export default function ExclusionBanner({
  id,
  name,
  type,
  meta,
  onRemoved,
}: Props) {
  const [excl, setExcl] = useState<Resolved | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [owner, setOwner] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDismissed(false);
    setConfirming(false);
    setReason("");
    setError(null);

    const outreach = str(meta.outreach);
    if (outreach === "excluded") {
      setExcl({
        by: str(meta.outreach_by) ?? "unknown",
        at: str(meta.outreach_at) ?? "",
        reason: str(meta.outreach_reason) ?? "",
      });
    } else {
      setExcl(null);
      if (ORG_TYPES.has(type)) {
        api.exclusions().then((list) => {
          if (!alive || !list) return;
          const hit = list.find((e) => e.company_id === id);
          if (hit) setExcl({ by: hit.by, at: hit.at, reason: hit.reason });
        });
      }
    }
    isOwner().then((o) => {
      if (alive) setOwner(o);
    });
    return () => {
      alive = false;
    };
  }, [id, type, meta]);

  if (!excl || dismissed) return null;

  const doRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeExclusion(id, reason);
      setDismissed(true);
      onRemoved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      if (msg === "FORBIDDEN") {
        setOwner(false);
        setError("Owner only");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="excl-banner" role="status">
      <div className="excl-banner-row">
        <span className="excl-banner-icon" aria-hidden>
          ⚠
        </span>
        <div className="excl-banner-text">
          <div className="excl-banner-title">Excluded from outreach</div>
          <div className="excl-banner-sub">
            by <b>{excl.by}</b>
            {excl.at && (
              <>
                {" · "}
                <span title={new Date(excl.at).toLocaleString()}>
                  {relativeTime(excl.at)}
                </span>
              </>
            )}
            {excl.reason && <>{": "}{excl.reason}</>}
          </div>
        </div>
        {owner && !confirming && (
          <button
            className="btn ghost sm excl-banner-btn"
            onClick={() => setConfirming(true)}
            title="Re-include in outreach"
          >
            Remove
          </button>
        )}
      </div>

      {owner && confirming && (
        <div className="excl-banner-confirm">
          <div className="excl-banner-confirm-msg">
            <b>{name}</b> will re-enter outreach. Are you sure?
          </div>
          <input
            className="np-input"
            value={reason}
            placeholder="Optional reason (recorded)…"
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirming(false);
            }}
          />
          <div className="excl-banner-confirm-actions">
            <button
              className="btn ghost sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button className="btn primary sm" disabled={busy} onClick={doRemove}>
              {busy ? "Working…" : "Re-include"}
            </button>
          </div>
        </div>
      )}

      {error && <div className="excl-banner-err">{error}</div>}
    </div>
  );
}
