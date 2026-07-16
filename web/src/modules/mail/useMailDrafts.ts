import { useCallback, useEffect, useState } from "react";
import type { MailDraft } from "@/core/types";
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
  reject: (id: string, reason?: string) => Promise<void>;
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
  const [nonce, setNonce] = useState(0);

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
    async (id: string, reason?: string) => {
      setBusyId(id);
      setError(null);
      try {
        await api.rejectMailDraft(id, reason);
        drop(id);
      } catch (e) {
        setError((e as Error)?.message ?? "Reject failed");
        throw e;
      } finally {
        setBusyId(null);
      }
    },
    [drop]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { drafts, loading, busyId, error, approve, reject, reload };
}
