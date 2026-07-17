import { useCallback, useEffect, useRef, useState } from "react";
import type { Exclusion } from "@/core/types";
import { api } from "@/core/api";
import { isOwner } from "@/core/viewer";

export interface ExclusionsState {
  items: Exclusion[] | null; // null = endpoint unavailable (hide section)
  loading: boolean;
  owner: boolean;
  busyId: string | null;
  notice: string | null;
  remove: (companyId: string, reason?: string) => Promise<boolean>;
  dismissNotice: () => void;
}

// Loads the workspace's outreach exclusions and exposes the owner-only override
// (re-include). A 403 from the server flips `owner` off so the UI can disable
// the control with an explanation. On a successful override the company drops
// out of the local list and a short note is surfaced.
export function useExclusions(): ExclusionsState {
  const [items, setItems] = useState<Exclusion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.exclusions().then((x) => {
      if (!alive) return;
      setItems(x);
      setLoading(false);
    });
    isOwner().then((o) => {
      if (alive) setOwner(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  const flash = useCallback((msg: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setNotice(msg);
    timer.current = window.setTimeout(() => {
      setNotice(null);
      timer.current = null;
    }, 4_000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const remove = useCallback(
    async (companyId: string, reason?: string): Promise<boolean> => {
      setBusyId(companyId);
      try {
        const target = items?.find((e) => e.company_id === companyId);
        await api.removeExclusion(companyId, reason);
        setItems((cur) => cur?.filter((e) => e.company_id !== companyId) ?? cur);
        flash(
          target
            ? `${target.name} is back in outreach.`
            : "Company is back in outreach."
        );
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed";
        if (msg === "FORBIDDEN") {
          setOwner(false);
          flash("Only the workspace owner can override exclusions.");
        } else {
          flash(`Could not override: ${msg}`);
        }
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [items, flash]
  );

  const dismissNotice = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setNotice(null);
    timer.current = null;
  }, []);

  return { items, loading, owner, busyId, notice, remove, dismissNotice };
}
