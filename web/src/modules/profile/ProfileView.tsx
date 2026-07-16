export default function ProfileView() {
  return (
    <div className="view-pad">
      <div className="int-head">
        <h2>Profile</h2>
        <span className="int-sub">Account and access</span>
      </div>

      <div className="stub-card">
        <div className="stub-avatar">T</div>
        <div className="stub-meta">
          <div className="stub-name">tuna</div>
          <div className="stub-sub">
            <span className="badge ok">owner</span>
          </div>
        </div>
      </div>

      <div className="stub-note">
        User management — inviting teammates, roles and permissions — is coming
        soon.
      </div>
    </div>
  );
}
