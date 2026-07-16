import { useState } from "react";
import type { Integration } from "@/core/integrations";
import { INTEGRATIONS, STATUS_META } from "@/core/integrations";

export default function IntegrationsView() {
  const [active, setActive] = useState<Integration | null>(null);

  return (
    <div className="view-pad">
      <div className="int-head">
        <h2>Integrations</h2>
        <span className="int-sub">
          Services Outpost is connected to and has planned
        </span>
      </div>

      <div className="int-grid">
        {INTEGRATIONS.map((it) => {
          const meta = STATUS_META[it.status];
          return (
            <button
              key={it.id}
              className="int-card"
              onClick={() => setActive(it)}
            >
              <div className="int-card-top">
                <span className="int-name">{it.name}</span>
                <span className={`badge ${meta.tone}`}>{meta.label}</span>
              </div>
              <div className="int-desc">{it.desc}</div>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="modal-backdrop" onClick={() => setActive(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setActive(null)}>
              ✕
            </button>
            <div className="modal-badge">
              <span className={`badge ${STATUS_META[active.status].tone}`}>
                {STATUS_META[active.status].label}
              </span>
            </div>
            <h3>{active.name}</h3>
            <p className="modal-desc">{active.detail}</p>
            {active.status !== "connected" && (
              <div className="modal-soon">Coming soon</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
