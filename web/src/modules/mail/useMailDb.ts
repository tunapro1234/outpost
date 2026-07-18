import { useCallback, useEffect, useState } from "react";
import type { MailRecord, MailRecordDetail, MailAnalytics } from "@/core/types";
import { api } from "@/core/api";

export interface UseMailDb {
  /** null = endpoint not available yet (fall back to the plain mail log). */
  records: MailRecord[] | null;
  analytics: MailAnalytics | null;
  loading: boolean;
  reload: () => void;
  /** Lazily fetch the full provenance for one mail (prompt, body, events). */
  detail: (id: string) => Promise<MailRecordDetail | null>;
}

/**
 * Loads the canonical mail DB (one record per approved mail: content + tracking
 * + creation provenance) plus the reply-rate analytics. The Sent tab renders the
 * records; the Insights tab renders the analytics. Detail is fetched on demand
 * so the list stays light.
 */
export function useMailDb(): UseMailDb {
  const [records, setRecords] = useState<MailRecord[] | null>(null);
  const [analytics, setAnalytics] = useState<MailAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.maildb(), api.mailanalytics()])
      .then(([recs, stats]) => {
        if (!alive) return;
        setRecords(recs);
        setAnalytics(stats);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setRecords(null);
        setAnalytics(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const detail = useCallback((id: string) => api.maildbDetail(id), []);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { records, analytics, loading, reload, detail };
}
