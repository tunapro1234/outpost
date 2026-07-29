import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode } from "@/core/types";
import type { WorkspaceInfo } from "@/core/types";
import type { ThemeName } from "@/core/theme";
import { typeColors, TYPE_LABELS } from "@/core/theme";
import { matchScore } from "@/core/normalize";
import { IconSearch } from "@/core/icons";

interface Props {
  title: string;
  workspace: string;
  workspaces: WorkspaceInfo[];
  onWorkspaceChange: (id: string) => void;
  onOpenMenu: () => void;
  showGraphToggle: boolean;
  graphMode: "graph" | "list";
  onGraphMode: (m: "graph" | "list") => void;
  nodes: GraphNode[];
  onPick: (id: string) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  theme: ThemeName;
  onToggleTheme: () => void;
}

export default function TopBar({
  title,
  workspace,
  workspaces,
  onWorkspaceChange,
  onOpenMenu,
  showGraphToggle,
  graphMode,
  onGraphMode,
  nodes,
  onPick,
  searchRef,
  theme,
  onToggleTheme,
}: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const tc = typeColors(theme);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    return nodes
      .map((n) => ({ n, s: matchScore(q, n.name) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((r) => r.n);
  }, [q, nodes]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
      if (topbarRef.current && !topbarRef.current.contains(e.target as Node))
        setMobileActionsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (n: GraphNode) => {
    onPick(n.id);
    setOpen(false);
    setQ("");
    searchRef.current?.blur();
  };

  return (
    <div className="topbar" ref={topbarRef}>
      <button
        className="mobile-menu-btn"
        onClick={onOpenMenu}
        title="Open navigation"
        aria-label="Open navigation menu"
      >
        <span />
        <span />
        <span />
      </button>

      <select
        className="mobile-workspace-select"
        value={workspace}
        onChange={(event) => onWorkspaceChange(event.target.value)}
        aria-label="Workspace"
      >
        {workspaces
          .filter((item) => !item.comingSoon)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
      </select>

      <div className="hdr-title">{title}</div>

      <div className="hdr-center">
        {showGraphToggle && (
          <div className="seg emphatic">
            <button
              className={graphMode === "graph" ? "on" : ""}
              onClick={() => onGraphMode("graph")}
            >
              Graph
            </button>
            <button
              className={graphMode === "list" ? "on" : ""}
              onClick={() => onGraphMode("list")}
            >
              List
            </button>
          </div>
        )}
      </div>

      <button
        className={`topbar-more ${mobileActionsOpen ? "on" : ""}`}
        onClick={() => setMobileActionsOpen((value) => !value)}
        title="More actions"
        aria-label="More actions"
        aria-expanded={mobileActionsOpen}
      >
        ⋯
      </button>

      <div className={`hdr-right ${mobileActionsOpen ? "mobile-open" : ""}`}>
        <div className="search" ref={boxRef}>
          <span className="ico">
            <IconSearch size={16} />
          </span>
          <input
            ref={searchRef}
            value={q}
            placeholder="Search people, orgs, channels…"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => q && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                pick(results[active]);
              } else if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
                setOpen(false);
              }
            }}
          />
          {!q && <span className="kbd">/</span>}
          {open && q && (
            <div className="search-results">
              {results.length === 0 ? (
                <div className="empty">No matching nodes</div>
              ) : (
                results.map((n, i) => (
                  <div
                    key={n.id}
                    className={`row ${i === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(n)}
                  >
                    <span
                      className="swatch"
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        background: tc[n.type],
                      }}
                    />
                    <span className="name">{n.name}</span>
                    <span className="meta">{TYPE_LABELS[n.type]}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </div>
    </div>
  );
}
