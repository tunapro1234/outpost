import { useEffect, useMemo, useState } from "react";
import { api } from "@/core/api";
import type { UserStat, WorkspaceInfo } from "@/core/types";

interface Props {
  workspace: string;
  workspaces: WorkspaceInfo[];
}

// Format a token count, prefixing "~" when the totals are a chars/4 estimate.
function tokens(n: number, estimated?: boolean): string {
  const v = n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
  return estimated ? `~${v}` : v;
}

// SPEC-MAILCAL §3 — the Workspace page. A per-user activity table (drafts,
// approvals, rejections, token spend) plus a short workspace header. Degrades
// to an empty state while the /users/stats endpoint is still shipping.
export default function WorkspaceView({ workspace, workspaces }: Props) {
  const [stats, setStats] = useState<UserStat[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setStats(null);
    api
      .usersStats()
      .then((s) => {
        if (!alive) return;
        setStats(s);
        setLoaded(true);
      })
      .catch(() => {
        if (!alive) return;
        setStats(null);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [workspace]);

  const info = useMemo(
    () => workspaces.find((w) => w.id === workspace),
    [workspaces, workspace]
  );

  const totals = useMemo(() => {
    const rows = stats ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.drafts += r.drafts;
        acc.approved += r.approved;
        acc.rejected += r.rejected;
        return acc;
      },
      { drafts: 0, approved: 0, rejected: 0 }
    );
  }, [stats]);

  return (
    <div className="view-pad">
      <div className="int-head">
        <h2>{info?.name ?? workspace}</h2>
        <span className="int-sub">
          {info?.entities != null
            ? `${info.entities.toLocaleString()} entities · `
            : ""}
          Per-user outreach activity across this workspace.
        </span>
      </div>

      {(stats?.length ?? 0) > 0 && (
        <div className="ws-summary">
          <span className="ws-summary-item">
            <b>{stats!.length}</b> {stats!.length === 1 ? "member" : "members"}
          </span>
          <span className="ws-summary-item">
            <b>{totals.drafts}</b> drafts
          </span>
          <span className="ws-summary-item">
            <b>{totals.approved}</b> approved
          </span>
          <span className="ws-summary-item">
            <b>{totals.rejected}</b> rejected
          </span>
        </div>
      )}

      {!loaded ? (
        <div className="empty-state">
          <div className="es-title">Loading…</div>
        </div>
      ) : stats === null ? (
        <div className="empty-state">
          <div className="es-title">Workspace stats coming online</div>
          <div className="es-sub">
            We can't reach the stats service just yet. Once activity starts
            flowing, you'll see each member's drafts, approvals and token spend
            right here.
          </div>
        </div>
      ) : stats.length === 0 ? (
        <div className="empty-state">
          <div className="es-title">No activity to show yet</div>
          <div className="es-sub">
            As your team starts drafting mail, everyone's activity rolls up here.
          </div>
        </div>
      ) : (
        <table className="grid ws-grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="num">Drafts</th>
              <th className="num">Approved</th>
              <th className="num">Rejected</th>
              <th className="num">Tokens in</th>
              <th className="num">Tokens out</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((u) => (
              <tr key={u.user}>
                <td className="c-name">{u.name || u.user}</td>
                <td>
                  <span className="badge muted">{u.role}</span>
                </td>
                <td className="num">{u.drafts}</td>
                <td className="num" style={{ color: "var(--ok)" }}>
                  {u.approved}
                </td>
                <td className="num" style={{ color: "var(--danger)" }}>
                  {u.rejected}
                </td>
                <td className="num mono">
                  {tokens(u.tokens.in, u.tokens.estimated)}
                </td>
                <td className="num mono">
                  {tokens(u.tokens.out, u.tokens.estimated)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
