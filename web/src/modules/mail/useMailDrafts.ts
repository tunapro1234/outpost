import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MailDraft,
  MailRejectPayload,
  MailRejectResult,
} from "@/core/types";
import { api } from "@/core/api";

export interface ApprovePayload {
  variant: number;
  subject?: string;
  body?: string;
}

export interface UseMailDrafts {
  /** null = endpoint not available yet (hide the surface), [] = no drafts. */
  drafts: MailDraft[] | null;
  loading: boolean;
  /** id of the draft currently being approved/rejected, if any. */
  busyId: string | null;
  error: string | null;
  approve: (id: string, payload: ApprovePayload) => Promise<void>;
  reject: (
    id: string,
    payload?: MailRejectPayload
  ) => Promise<MailRejectResult>;
  /** Transient note surfaced after a cascading reject (e.g. company excluded). */
  notice: string | null;
  dismissNotice: () => void;
  reload: () => void;
}

/**
 * Shared loader for the mail approval surfaces (Overview section + Reach tab).
 * Optimistically drops a draft from the local list once the server confirms the
 * approve/reject so both surfaces stay in step without a refetch round-trip.
 */
export function useMailDrafts(): UseMailDrafts {
  const [drafts, setDrafts] = useState<MailDraft[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const noticeTimer = useRef<number | null>(null);

  const showNotice = useCallback((msg: string) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 6000);
  }, []);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    setNotice(null);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .maildrafts()
      .then((d) => {
        if (!alive) return;
        setDrafts(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setDrafts(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const drop = useCallback((id: string) => {
    setDrafts((cur) => (cur ? cur.filter((d) => d.id !== id) : cur));
  }, []);

  const approve = useCallback(
    async (id: string, payload: ApprovePayload) => {
      setBusyId(id);
      setError(null);
      try {
        await api.approveMailDraft(id, payload);
        drop(id);
      } catch (e) {
        setError((e as Error)?.message ?? "Approval failed");
        throw e;
      } finally {
        setBusyId(null);
      }
    },
    [drop]
  );

  const reject = useCallback(
    async (id: string, payload?: MailRejectPayload) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await api.rejectMailDraft(id, payload);
        // Drop every draft the server cascaded (falls back to [id]).
        const ids = new Set(res.rejected.length ? res.rejected : [id]);
        setDrafts((cur) => (cur ? cur.filter((d) => !ids.has(d.id)) : cur));
        if (res.company_excluded) {
          showNotice(`${res.company_excluded.name} excluded from outreach`);
        }
        return res;
      } catch (e) {
        setError((e as Error)?.message ?? "Reject failed");
        throw e;
      } finally {
        setBusyId(null);
      }
    },
    [showNotice]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    drafts,
    loading,
    busyId,
    error,
    approve,
    reject,
    notice,
    dismissNotice,
    reload,
  };
}
