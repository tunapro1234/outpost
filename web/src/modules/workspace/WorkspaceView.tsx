const WORKSPACES = [
  { id: "probot", name: "probot", active: true },
  { id: "compec", name: "compec", active: false },
];

export default function WorkspaceView() {
  return (
    <div className="view-pad">
      <div className="int-head">
        <h2>Workspace</h2>
        <span className="int-sub">Active workspace and switching</span>
      </div>

      <div className="ws-list">
        {WORKSPACES.map((w) => (
          <div key={w.id} className={`ws-card ${w.active ? "active" : ""}`}>
            <span className="ws-avatar">{w.name[0].toUpperCase()}</span>
            <div className="ws-card-meta">
              <div className="ws-card-name">{w.name}</div>
              <div className="ws-card-sub">
                {w.active ? "Active workspace" : "Coming soon"}
              </div>
            </div>
            {w.active ? (
              <span className="badge ok">active</span>
            ) : (
              <span className="badge muted">soon</span>
            )}
          </div>
        ))}
      </div>

      <div className="stub-note">
        Multi-workspace switching and per-workspace data isolation are coming
        soon.
      </div>
    </div>
  );
}
