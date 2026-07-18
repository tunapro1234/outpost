import { useCallback, useEffect, useRef, useState } from "react";
import type { MailSettings } from "@/core/types";
import { api } from "@/core/api";

export interface UseMailSettings {
  /** null = endpoint not available yet (show a coming-online state). */
  settings: MailSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Transient confirmation surfaced after a save/import/reset. */
  notice: string | null;
  showNotice: (msg: string) => void;
  dismissNotice: () => void;
  /** Persist only the changed fields; updates local state on success. */
  save: (patch: Partial<MailSettings>) => Promise<void>;
  reload: () => void;
}

/**
 * Loader + saver for the Mail → Settings tab. Mirrors useMailDrafts: a single
 * fetch with a null-on-404 fallback, plus a small self-clearing notice used for
 * "saved" / import-count / calibration-reset confirmations.
 */
export function useMailSettings(): UseMailSettings {
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
    }, 4000);
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
      .mailSettings()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setSettings(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const save = useCallback(
    async (patch: Partial<MailSettings>) => {
      setSaving(true);
      setError(null);
      try {
        const next = await api.updateMailSettings(patch);
        setSettings(next);
        showNotice("Ayar kaydedildi");
      } catch (e) {
        setError((e as Error)?.message ?? "Kaydedilemedi");
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [showNotice]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    settings,
    loading,
    saving,
    error,
    notice,
    showNotice,
    dismissNotice,
    save,
    reload,
  };
}
