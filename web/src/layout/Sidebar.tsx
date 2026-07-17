import { useEffect, useRef, useState } from "react";
import type { WorkspaceInfo } from "@/core/types";

export type NavKey =
  | "overview"
  | "network"
  | "mail"
  | "agents"
  | "workspace"
  | "integrations"
  | "profile";

interface Props {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  workspace: string;
  workspaces: WorkspaceInfo[];
  onWorkspaceChange: (id: string) => void;
}

const Icons: Record<NavKey, JSX.Element> = {
  overview: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.4" />
      <rect x="14" y="3" width="7" height="5" rx="1.4" />
      <rect x="14" y="12" width="7" height="9" rx="1.4" />
      <rect x="3" y="16" width="7" height="5" rx="1.4" />
    </svg>
  ),
  network: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="17" r="2.4" />
      <path d="M7.7 8.4 10.6 15M16.6 7.7 13.3 15.4M8 7l7.8-.6" />
    </svg>
  ),
  mail: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2.4" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  ),
  agents: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 8V4M9 4h6M8.5 13v2M15.5 13v2" />
    </svg>
  ),
  workspace: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  integrations: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3v4M14 3v4M6 7h12v5a6 6 0 0 1-12 0zM12 18v3" />
    </svg>
  ),
  profile: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  ),
};

const TOP: { k: NavKey; label: string }[] = [
  { k: "overview", label: "Overview" },
  { k: "network", label: "Network" },
  { k: "mail", label: "Mail" },
  { k: "agents", label: "Agents" },
];
const BOTTOM: { k: NavKey; label: string }[] = [
  { k: "workspace", label: "Workspace" },
  { k: "integrations", label: "Integrations" },
  { k: "profile", label: "Profile" },
];

export default function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggleCollapse,
  workspace,
  workspaces,
  onWorkspaceChange,
}: Props) {
  const [wsOpen, setWsOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node))
        setWsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const Item = ({ k, label }: { k: NavKey; label: string }) => (
    <button
      className={`side-item ${active === k ? "on" : ""}`}
      onClick={() => onNavigate(k)}
      title={collapsed ? label : undefined}
    >
      <span className="side-ico">{Icons[k]}</span>
      {!collapsed && <span className="side-label">{label}</span>}
    </button>
  );

  return (
    <nav className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="side-brand">
        <span className="side-mark">O</span>
        {!collapsed && <span className="side-word">Outpost</span>}
      </div>

      <div className="side-group">
        {TOP.map((i) => (
          <Item key={i.k} {...i} />
        ))}
      </div>

      <div className="side-spacer" />
      <div className="side-sep" />

      <div className="side-group">
        {BOTTOM.map((i) => (
          <Item key={i.k} {...i} />
        ))}
      </div>

      <div className="side-ws-wrap" ref={wsRef}>
        {wsOpen && (
          <div className="ws-pop">
            <div className="ws-pop-label">Workspace</div>
            {workspaces.map((w) => {
              const active = w.id === workspace;
              return (
                <button
                  key={w.id}
                  className={`ws-pop-item ${active ? "active" : ""} ${
                    w.comingSoon ? "disabled" : ""
                  }`}
                  disabled={w.comingSoon}
                  onClick={() => {
                    if (!w.comingSoon) {
                      onWorkspaceChange(w.id);
                      setWsOpen(false);
                    }
                  }}
                >
                  <span className="ws-pop-dot" />
                  <span className="ws-pop-name">{w.name}</span>
                  {active && <span className="badge ok">active</span>}
                  {w.comingSoon && <span className="badge muted">soon</span>}
                </button>
              );
            })}
          </div>
        )}
        <button
          className={`side-ws ${wsOpen ? "open" : ""}`}
          onClick={() => setWsOpen((o) => !o)}
          title={collapsed ? `Workspace · ${workspace}` : undefined}
        >
          <span className="ws-dot" />
          {!collapsed && (
            <span className="ws-meta">
              <span className="ws-k">Workspace</span>
              <span className="ws-v">{workspace}</span>
            </span>
          )}
          {!collapsed && <span className="ws-caret">▾</span>}
        </button>
      </div>

      <button className="side-collapse" onClick={onToggleCollapse}>
        {collapsed ? "»" : "«"}
      </button>
    </nav>
  );
}
