import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WorkspaceInfo } from "@/core/types";

export type NavKey =
  | "today"
  | "overview"
  | "network"
  | "schools"
  | "institutions"
  | "teams"
  | "teachers"
  | "competitors"
  // ⚠️ NavKey ile router'daki ViewKey AYRI iki union ve elle senkron tutuluyor.
  // Yeni bir liste eklerken İKİSİNE birden yazılmazsa tsc yakalıyor (bugün yakaladı),
  // ama kayması mümkün olduğu için not düşülüyor: burayı değiştiren core/router.ts'e de bakar.
  | "ftc2027"
  | "ftcSezonu"
  | "sogukHat"
  | "tumKayitlar"
  | "atolyeler"
  | "mail"
  | "agents"
  | "workspace"
  | "integrations"
  | "profile";

interface Props {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  hidden: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  width: number;
  resizing: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  workspace: string;
  workspaces: WorkspaceInfo[];
  onWorkspaceChange: (id: string) => void;
}

const Icons: Record<NavKey, JSX.Element> = {
  today: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18M8 15h3M8 18h7" />
    </svg>
  ),
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
  schools: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 10 9-5 9 5-9 5zM6 13v5h12v-5M21 10v6" />
    </svg>
  ),
  institutions: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16M6 20V9h12v11M3 9l9-5 9 5M9 12v5M15 12v5" />
    </svg>
  ),
  teams: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M14 15.5a4.5 4.5 0 0 1 6.5 4" />
    </svg>
  ),
  teachers: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M14 6h7M17.5 6v8M15 11h5" />
    </svg>
  ),
  competitors: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4H4v3a4 4 0 0 0 4 4M16 4h4v3a4 4 0 0 1-4 4M8 3h8v5a4 4 0 0 1-8 0zM12 12v5M8 21h8M9 17h6" />
    </svg>
  ),
  ftc2027: (
    // Takım/mentor ikonu: bir merkez ve ona bağlı üç kişi. FTC mentorluğu bir
    // unvan değil bir bağ olduğu için rozet değil ilişki çizimi seçildi.
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="7" r="3" />
      <path d="M12 10v4M12 14l-5 4M12 14l5 4" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
    </svg>
  ),
  ftcSezonu: (
    // Sezon ikonu: takvim/tur çemberi içinde bir hedef. Ayrı bir ağın (ftc)
    // tamamı olduğu için 2027 FTC'nin bağ çiziminden kasten farklı duruyor.
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
    </svg>
  ),
  tumKayitlar: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="4" rx="1" />
      <rect x="4" y="10" width="16" height="4" rx="1" />
      <rect x="4" y="16" width="16" height="4" rx="1" />
    </svg>
  ),
  atolyeler: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.8-2.8 2.4-2.8z" />
    </svg>
  ),
  sogukHat: (
    // Soğuk hat: kar tanesi (soğuk temas) — mail ikonundan ayrışsın diye
    // zarf/telefon değil, sıcaklık metaforu seçildi.
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
      <path d="M12 6.5 9.8 4.6M12 6.5l2.2-1.9M12 17.5l-2.2 1.9M12 17.5l2.2 1.9" />
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
  { k: "today", label: "Bugün" },
  { k: "overview", label: "Overview" },
  { k: "network", label: "Network" },
];
const LISTS: { k: NavKey; label: string }[] = [
  // Tuna, 21 Ağu: "listeler dağınık" — envanter listeleri (Okullar/Kurumlar/
  // Takımlar/Öğretmenler) kaldırıldı, rotaları deep-link olarak yaşıyor.
  // 2027 FTC artık ftc ağının (FTC Sezonu grafiği) üstüne bağlı — iki FTC
  // girdisi tekilleştirildi, en zengin veri kaynağı kazandı.
  { k: "ftc2027", label: "2027 FTC" },
  { k: "tumKayitlar", label: "Tüm Kayıtlar" },
  { k: "atolyeler", label: "Atölyeler" },
  { k: "competitors", label: "Rakipler" },
  { k: "sogukHat", label: "Soğuk Hat" },
];
const MODULES: { k: NavKey; label: string }[] = [
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
  hidden,
  mobileOpen,
  onClose,
  width,
  resizing,
  onResizeStart,
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

  const Item = ({
    k,
    label,
    nested = false,
  }: {
    k: NavKey;
    label: string;
    nested?: boolean;
  }) => (
    <button
      className={`side-item ${nested ? "nested" : ""} ${
        active === k ? "on" : ""
      }`}
      onClick={() => onNavigate(k)}
    >
      <span className="side-ico">{Icons[k]}</span>
      <span className="side-label">{label}</span>
    </button>
  );

  // While hidden the rail collapses to zero width; keep it un-focusable so the
  // clipped content can't be tabbed into behind the reveal handle.
  const style: CSSProperties = { width: hidden ? 0 : width };

  return (
    <nav
      className={`sidebar ${hidden ? "hidden" : ""} ${
        mobileOpen ? "mobile-open" : ""
      } ${resizing ? "resizing" : ""}`}
      style={style}
      aria-hidden={hidden}
    >
      <div className="side-brand">
        <span className="side-mark">O</span>
        <span className="side-word">Outpost</span>
        <button
          className="side-brand-toggle"
          onClick={onClose}
          title="Sidebar’ı gizle (⌘B / Ctrl+B)"
          aria-label="Sidebar’ı gizle"
        >
          «
        </button>
      </div>

      <div className="side-group">
        {TOP.map((i) => (
          <Item key={i.k} {...i} />
        ))}
      </div>

      <div className="side-list-group">
        <div className="side-section-label">Listeler</div>
        {LISTS.map((i) => (
          <Item key={i.k} {...i} nested />
        ))}
      </div>

      <div className="side-group side-modules">
        {MODULES.map((i) => (
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
        >
          <span className="ws-dot" />
          <span className="ws-meta">
            <span className="ws-k">Workspace</span>
            <span className="ws-v">{workspace}</span>
          </span>
          <span className="ws-caret">▾</span>
        </button>
      </div>

      {/* Right-edge drag handle: resize between min/max, highlights on hover. */}
      <div
        className="side-resize"
        onMouseDown={onResizeStart}
        title="Drag to resize"
        role="separator"
        aria-orientation="vertical"
      />
    </nav>
  );
}
