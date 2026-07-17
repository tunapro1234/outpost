import { useEffect, useRef, useState } from "react";
import type { Physics } from "@/core/physics";
import { DEFAULT_PHYSICS } from "@/core/physics";

interface Props {
  physics: Physics;
  setPhysics: (p: Physics) => void;
  onClose: () => void;
}

const LS_POS = "outpost.physicsPanelPos";

// Module-level: defining this inside the component remounts the <input> on
// every render, which kills an in-progress slider drag after one step.
function Row(p: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="np-phys-row">
      <span className="np-phys-label">{p.label}</span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
      <span className="np-val">
        {p.fmt ? p.fmt(p.value) : Math.round(p.value)}
      </span>
    </div>
  );
}

export default function PhysicsPanel({ physics, setPhysics, onClose }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(LS_POS);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { x: -1, y: 58 }; // x<0 => anchor right on first render
  });
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // resolve right-anchor on mount
  useEffect(() => {
    if (pos.x < 0 && ref.current) {
      const parent = ref.current.parentElement;
      const w = ref.current.offsetWidth;
      const pw = parent?.clientWidth ?? window.innerWidth;
      setPos({ x: pw - w - 16, y: 58 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    };
    const onUp = () => {
      if (drag.current) {
        drag.current = null;
        document.body.style.userSelect = "";
        try {
          localStorage.setItem(LS_POS, JSON.stringify(pos));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pos]);

  const setPhys = (patch: Partial<Physics>) =>
    setPhysics({ ...physics, ...patch });

  const startDrag = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    document.body.style.userSelect = "none";
  };

  return (
    <div
      ref={ref}
      className="phys-float"
      style={{ left: Math.max(0, pos.x), top: Math.max(0, pos.y) }}
    >
      <div className="phys-float-head" onMouseDown={startDrag}>
        <span className="phys-grip">⠿</span>
        <span className="phys-title">Physics</span>
        <button
          className="phys-min"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <button className="phys-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>
      {!collapsed && (
        <div className="phys-float-body">
          {/* Obsidian Forces paritesi: Center / Repel / Link force / Link distance */}
          <Row
            label="Center force"
            min={0}
            max={0.3}
            step={0.01}
            value={physics.gravity}
            onChange={(v) => setPhys({ gravity: v })}
            fmt={(v) => v.toFixed(2)}
          />
          <Row
            label="Repel force"
            min={40}
            max={500}
            step={10}
            value={physics.charge}
            onChange={(v) => setPhys({ charge: v })}
          />
          <Row
            label="Link force"
            min={0}
            max={1}
            step={0.05}
            value={physics.linkForce}
            onChange={(v) => setPhys({ linkForce: v })}
            fmt={(v) => v.toFixed(2)}
          />
          <Row
            label="Link distance"
            min={20}
            max={250}
            step={5}
            value={physics.linkDistance}
            onChange={(v) => setPhys({ linkDistance: v })}
          />
          <Row
            label="Collision"
            min={0}
            max={3}
            step={0.1}
            value={physics.collide}
            onChange={(v) => setPhys({ collide: v })}
            fmt={(v) => v.toFixed(1)}
          />
          <Row
            label="Velocity decay"
            min={0.1}
            max={0.9}
            step={0.02}
            value={physics.velocityDecay}
            onChange={(v) => setPhys({ velocityDecay: v })}
            fmt={(v) => v.toFixed(2)}
          />
          <div className="np-phys-btns">
            <button
              className={`np-btn ${physics.frozen ? "on" : ""}`}
              onClick={() => setPhys({ frozen: !physics.frozen })}
            >
              {physics.frozen ? "Thaw" : "Freeze"}
            </button>
            <button
              className="np-btn"
              onClick={() => setPhysics({ ...DEFAULT_PHYSICS })}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
