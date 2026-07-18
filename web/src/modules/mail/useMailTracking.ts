import { useEffect, useState } from "react";
import type { MailTrackingRow } from "@/core/types";
import { api } from "@/core/api";

export interface UseMailTracking {
  /** null = endpoint not available yet (fall back to the plain mail log). */
  rows: MailTrackingRow[] | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads open/click tracking rows for the Sent tab. One row per approved mail;
 * status climbs queued → delivered → opened → clicked as events arrive from the
 * tracking pixel, click redirects, and the Brevo webhook.
 */
export function useMailTracking(): UseMailTracking {
  const [rows, setRows] = useState<MailTrackingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .mailtracking()
      .then((summary) => {
        if (!alive) return;
        setRows(summary ? summary.rows : null);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setRows(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  return { rows, loading, reload: () => setNonce((n) => n + 1) };
}
