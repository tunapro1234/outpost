import { useEffect, useState } from "react";
import type { Profile } from "@/core/types";
import { api } from "@/core/api";

const FALLBACK: Profile = {
  username: "tuna",
  name: "Tuna",
  mail: "",
  phone: "",
  role: "owner",
};

type Toast = { kind: "ok" | "err"; msg: string } | null;

export default function ProfileView() {
  const [profile, setProfile] = useState<Profile>(FALLBACK);
  const [live, setLive] = useState(false); // server-backed vs local fallback
  const [name, setName] = useState("");
  const [mail, setMail] = useState("");
  const [phone, setPhone] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    let alive = true;
    api.profile().then((p) => {
      if (!alive) return;
      const eff = p ?? FALLBACK;
      setProfile(eff);
      setLive(!!p);
      setName(eff.name);
      setMail(eff.mail);
      setPhone(eff.phone);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setDirty(
      name !== profile.name || mail !== profile.mail || phone !== profile.phone
    );
  }, [name, mail, phone, profile]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await api.patchProfile({ name, mail, phone });
      setProfile(updated);
      setLive(true);
      setToast({ kind: "ok", msg: "Profile updated" });
    } catch (e) {
      setToast({
        kind: "err",
        msg: (e as Error)?.message ?? "Could not save profile",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr(null);
    if (next.length < 6) {
      setPwErr("New password must be at least 6 characters");
      return;
    }
    if (next !== confirm) {
      setPwErr("Passwords do not match");
      return;
    }
    setSavingPw(true);
    try {
      await api.changePassword(cur, next);
      setCur("");
      setNext("");
      setConfirm("");
      setToast({ kind: "ok", msg: "Password changed" });
    } catch (err) {
      const msg = (err as Error)?.message ?? "Could not change password";
      setPwErr(msg);
      setToast({ kind: "err", msg });
    } finally {
      setSavingPw(false);
    }
  };

  const initial = (profile.name || profile.username || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div className="view-pad profile">
      <div className="int-head">
        <h2>Profile</h2>
        <span className="int-sub">Account details and access</span>
      </div>

      {!live && (
        <div className="prof-note">
          We can't reach the profile service yet, so these are local defaults.
          Your edits will save as soon as it's back.
        </div>
      )}

      <div className="prof-card">
        <div className="prof-id">
          <div className="prof-avatar">{initial}</div>
          <div className="prof-idmeta">
            <div className="prof-name">{profile.name || profile.username}</div>
            <div className="prof-idsub">
              <span className="prof-user">@{profile.username}</span>
              <span className="badge ok">{profile.role}</span>
            </div>
          </div>
        </div>

        <div className="prof-fields">
          <label className="prof-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="prof-field">
            <span>Mail</span>
            <input
              type="email"
              value={mail}
              placeholder="you@example.com"
              onChange={(e) => setMail(e.target.value)}
            />
          </label>
          <label className="prof-field">
            <span>Phone</span>
            <input
              value={phone}
              placeholder="+90 …"
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        </div>

        <div className="prof-actions">
          <button
            className="btn primary"
            disabled={!dirty || savingProfile}
            onClick={saveProfile}
          >
            {savingProfile ? "Saving…" : "Save changes"}
          </button>
          {dirty && (
            <button
              className="btn ghost"
              onClick={() => {
                setName(profile.name);
                setMail(profile.mail);
                setPhone(profile.phone);
              }}
            >
              Discard
            </button>
          )}
        </div>
      </div>

      <form className="prof-card prof-pw" onSubmit={changePassword}>
        <div className="prof-pw-head">
          <h3>Change password</h3>
          <span className="int-sub">
            You can only change your own sign-in password.
          </span>
        </div>
        <div className="prof-fields">
          <label className="prof-field">
            <span>Current password</span>
            <input
              type="password"
              value={cur}
              autoComplete="current-password"
              onChange={(e) => setCur(e.target.value)}
            />
          </label>
          <label className="prof-field">
            <span>New password</span>
            <input
              type="password"
              value={next}
              autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="prof-field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </div>
        {pwErr && <div className="prof-pw-err">{pwErr}</div>}
        <div className="prof-actions">
          <button
            className="btn primary"
            type="submit"
            disabled={savingPw || !cur || !next || !confirm}
          >
            {savingPw ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>

      {toast && (
        <div className={`prof-toast ${toast.kind}`}>{toast.msg}</div>
      )}
    </div>
  );
}
