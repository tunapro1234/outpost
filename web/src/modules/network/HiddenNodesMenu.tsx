import { useEffect, useRef, useState } from "react";
import type { GraphNode } from "@/core/types";

interface Props {
  nodes: GraphNode[];
  onShow: (id: string) => void;
  onShowAll: () => void;
}

export default function HiddenNodesMenu({ nodes, onShow, onShowAll }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!nodes.length) return null;

  return (
    <div className="hidden-nodes-wrap" ref={wrapRef}>
      <button
        className={`tool-btn hidden-nodes-chip ${open ? "on" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {nodes.length} gizli
      </button>
      {open && (
        <div className="hidden-nodes-pop" role="dialog" aria-label="Gizli node'lar">
          <div className="hidden-nodes-head">
            <span>Grafikte gizli</span>
            <button type="button" onClick={onShowAll}>
              Tümünü göster
            </button>
          </div>
          <div className="hidden-nodes-list">
            {nodes.map((node) => (
              <div className="hidden-node-row" key={node.id}>
                <span>
                  <b>{node.name}</b>
                  <small>{node.id}</small>
                </span>
                <button type="button" onClick={() => onShow(node.id)}>
                  Göster
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
