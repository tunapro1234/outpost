export type NavKey =
  | "network"
  | "reach"
  | "gather"
  | "integrations"
  | "profile"
  | "workspace";

interface Props {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  workspace: string;
}

const S = (p: { d: string; size?: number }) => (
  <svg
    width={p.size ?? 18}
    height={p.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={p.d} />
  </svg>
);

const Icons: Record<NavKey, JSX.Element> = {
  network: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="17" r="2.4" />
      <path d="M7.7 8.4 10.6 15M16.6 7.7 13.3 15.4M8 7l7.8-.6" />
    </svg>
  ),
  reach: <S d="M22 3 11 14M22 3l-7 18-4-8-8-4 19-6z" />,
  gather: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 8V4M9 4h6M8.5 13v2M15.5 13v2" />
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
  workspace: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="14" width="7" height="6" rx="1.4" />
      <rect x="13.5" y="14" width="7" height="6" rx="1.4" />
    </svg>
  ),
};

const TOP: { k: NavKey; label: string }[] = [
  { k: "network", label: "Network" },
  { k: "reach", label: "Reach" },
  { k: "gather", label: "Gather" },
];
const BOTTOM: { k: NavKey; label: string }[] = [
  { k: "integrations", label: "Integrations" },
  { k: "profile", label: "Profile" },
  { k: "workspace", label: "Workspace" },
];

export default function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggleCollapse,
  workspace,
}: Props) {
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

      <button
        className="side-ws"
        onClick={() => onNavigate("workspace")}
        title={collapsed ? `Workspace · ${workspace}` : undefined}
      >
        <span className="ws-dot" />
        {!collapsed && (
          <span className="ws-meta">
            <span className="ws-k">Workspace</span>
            <span className="ws-v">{workspace}</span>
          </span>
        )}
      </button>

      <button className="side-collapse" onClick={onToggleCollapse}>
        {collapsed ? "»" : "«"}
      </button>
    </nav>
  );
}
