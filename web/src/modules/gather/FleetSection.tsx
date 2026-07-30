import { useCallback, useEffect, useState } from "react";
import { api } from "@/core/api";
import type { FleetAgent, FleetResponse } from "@/core/types";

const EMPTY_FLEET: FleetResponse = {
  agents: [],
  unavailable: true,
  updatedAt: null,
};

const STATUS_LABELS: Record<FleetAgent["status"], string> = {
  working: "Çalışıyor",
  idle: "Boşta",
  closed: "Kapalı",
};

export default function FleetSection() {
  const [fleet, setFleet] = useState<FleetResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setFleet((await api.fleet()) ?? EMPTY_FLEET);
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await api.fleet();
      if (alive) setFleet(next ?? EMPTY_FLEET);
    };
    tick();
    const id = window.setInterval(tick, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const working = fleet?.agents.filter((agent) => agent.status === "working").length ?? 0;
  const idle = fleet?.agents.filter((agent) => agent.status === "idle").length ?? 0;
  const closed = fleet?.agents.filter((agent) => agent.status === "closed").length ?? 0;

  return (
    <section className="fleet">
      <div className="g-head fleet-head">
        <div>
          <h2>Filo</h2>
          <span className="int-sub">
            Probot agent filosunun canlı çalışma durumu.
          </span>
        </div>
        <button className="btn" disabled={refreshing} onClick={() => load(true)}>
          {refreshing ? "Yenileniyor…" : "Yenile"}
        </button>
      </div>

      {fleet === null ? (
        <div className="fleet-empty">Filo yükleniyor…</div>
      ) : fleet.unavailable ? (
        <div className="fleet-unavailable">
          Filo bilgisi şu anda kullanılamıyor.
        </div>
      ) : (
        <>
          <div className="fleet-summary" aria-label="Filo durum özeti">
            <span><b>{fleet.agents.length}</b> agent</span>
            <span className="working"><b>{working}</b> çalışıyor</span>
            <span><b>{idle}</b> boşta</span>
            <span><b>{closed}</b> kapalı</span>
          </div>

          {fleet.agents.length === 0 ? (
            <div className="fleet-empty">Bu filoda agent bulunamadı.</div>
          ) : (
            <div className="fleet-table-wrap">
              <table className="fleet-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Durum</th>
                    <th>Son konuşma</th>
                    <th>Token</th>
                    <th>Ne yapıyor</th>
                  </tr>
                </thead>
                <tbody>
                  {fleet.agents.map((agent) => (
                    <tr key={agent.name}>
                      <td className="fleet-name">{agent.name}</td>
                      <td>
                        <span className={`fleet-status ${agent.status}`}>
                          <span className="fleet-status-dot" />
                          {STATUS_LABELS[agent.status]}
                        </span>
                      </td>
                      <td className="fleet-mono">{agent.lastTalk ?? "—"}</td>
                      <td className="fleet-mono" title={agent.cache.raw}>
                        {agent.cache.tokens ?? "—"}
                      </td>
                      <td
                        className={`fleet-task ${
                          agent.currentTask === "unavailable" ? "unavailable" : ""
                        }`}
                        title={agent.currentTask ?? undefined}
                      >
                        {agent.currentTask === "unavailable"
                          ? "kullanılamıyor"
                          : agent.currentTask || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
