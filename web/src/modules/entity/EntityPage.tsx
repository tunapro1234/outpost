import { useEffect, useMemo, useState } from "react";
import type { Entity, GraphData, MailItem, Relation, Status } from "@/core/types";
import type { ThemeName } from "@/core/theme";
import {
  STATUS_LABELS,
  STATUS_ORDER,
  TYPE_LABELS,
  statusColors,
  typeColors,
} from "@/core/theme";
import { api } from "@/core/api";
import { trNormalize } from "@/core/normalize";
import { navigate, entityPath } from "@/core/router";
import { renderMarkdown } from "@/core/markdown";
import {
  IconGlobe,
  IconInstagram,
  IconLinkedin,
  IconMail,
  IconPhone,
  IconWhatsapp,
} from "@/core/icons";
import EntityMiniGraph from "./EntityMiniGraph";
import ExclusionBanner from "./ExclusionBanner";

type Tab = "overview" | "mails" | "activity" | "note";

interface Props {
  id: string;
  theme: ThemeName;
  onToggleTheme: () => void;
  mails: MailItem[] | null;
  graph: GraphData;
  onChanged: () => void;
}

function stripFrontmatter(body: string): string {
  return body.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

// Vault notes open with an `# Title` H1 that duplicates the entity name. That
// heading is already shown as the page title, so strip the single leading H1
// (plus the blank space it leaves) before rendering the note body. Only the
// title-matching H1 is removed — genuine in-body H1s are left intact.
function stripLeadingTitle(body: string, name?: string | null): string {
  const src = stripFrontmatter(body);
  const lines = src.split(/\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const m = lines[i]?.trim().match(/^#\s+(.+?)\s*$/);
  if (!m) return src;
  const matches = !name || trNormalize(m[1]) === trNormalize(name);
  if (!matches) return src;
  lines.splice(0, i + 1);
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.join("\n");
}

function ext(url: string): string {
  if (!url) return url;
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

// First real paragraph of the note body — skips the leading H1 / headings.
function firstParagraph(body: string): string {
  const lines = stripFrontmatter(body).split(/\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith("#")) {
      if (out.length) break;
      continue;
    }
    if (!t) {
      if (out.length) break;
      continue;
    }
    out.push(t);
  }
  return out.join(" ");
}

export default function EntityPage({
  id,
  theme,
  onToggleTheme,
  mails,
  graph,
  onChanged,
}: Props) {
  const TYPE_COLORS = typeColors(theme);
  const STATUS_COLORS = statusColors(theme);

  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [statusOpen, setStatusOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setTab("overview");
    setEditing(false);
    setStatusOpen(false);
    window.scrollTo(0, 0);
    api
      .entity(id)
      .then((e) => {
        if (!alive) return;
        setEntity(e);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const meta = entity?.meta;
  const type = meta?.type ?? "company";

  const setStatus = async (s: Status | null) => {
    if (!entity) return;
    setStatusOpen(false);
    const updated = await api.patchEntity(entity.id, { meta: { status: s } });
    setEntity(updated);
    onChanged();
  };

  const saveBody = async () => {
    if (!entity) return;
    setSaving(true);
    try {
      const updated = await api.patchEntity(entity.id, { body: draft });
      setEntity(updated);
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const { relOut, relIn, mentions } = useMemo(() => {
    const rels = entity?.relations ?? [];
    return {
      relOut: rels.filter((r) => r.kind === "relation" && r.direction === "out"),
      relIn: rels.filter((r) => r.kind === "relation" && r.direction === "in"),
      mentions: rels.filter((r) => r.kind === "mention"),
    };
  }, [entity]);

  const definition = useMemo(
    () => (entity ? firstParagraph(entity.body) : ""),
    [entity]
  );
  const bodyHtml = useMemo(() => {
    if (!entity) return "";
    return renderMarkdown(stripLeadingTitle(entity.body, entity.meta.name));
  }, [entity]);

  const entityMails = useMemo(() => {
    if (!mails) return [];
    return mails.filter((m) => m.entity_id === id || m.person_id === id);
  }, [mails, id]);

  const goto = (nid: string) => navigate(entityPath(nid));

  const RelRow = (r: Relation) => (
    <button
      key={`${r.direction}-${r.kind}-${r.id}`}
      className="rel"
      onClick={() => goto(r.id)}
    >
      <span className="dir">{r.direction === "out" ? "→" : "←"}</span>
      <span className="swatch" style={{ background: TYPE_COLORS[r.type] }} />
      <span className="r-name">{r.name}</span>
      {r.label && <span className="r-label">{r.label}</span>}
    </button>
  );

  return (
    <div className="entity-page">
      <div className="ep-topbar">
        <button className="ep-back" onClick={() => navigate("/network")}>
          ← Back
        </button>
        <div className="ep-crumb">
          <button className="ep-crumb-link" onClick={() => navigate("/network")}>
            Network
          </button>
          <span className="ep-crumb-sep">/</span>
          <span className="ep-crumb-cur">{meta?.name ?? id}</span>
        </div>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </div>

      <div className="ep-scroll">
        {notFound ? (
          <div className="empty-state" style={{ marginTop: "16vh" }}>
            <div className="es-title">We couldn't find that entity</div>
            <div className="es-sub">
              Nothing with id <code>{id}</code> lives in this workspace.
            </div>
          </div>
        ) : loading || !entity || !meta ? (
          <div className="ep-loading">Loading…</div>
        ) : (
          <>
            <ExclusionBanner
              id={entity.id}
              name={meta.name ?? entity.id}
              type={type}
              meta={meta}
              onRemoved={onChanged}
            />

            {/* identity strip */}
            <header className="ep-identity">
              <div className="ep-id-main">
                <div className="ep-id-top">
                  <span
                    className="ep-type"
                    style={{
                      background: `${TYPE_COLORS[type]}1f`,
                      color: TYPE_COLORS[type],
                    }}
                  >
                    <span
                      className="swatch"
                      style={{ background: TYPE_COLORS[type] }}
                    />
                    {TYPE_LABELS[type]}
                  </span>
                  <div className="ep-status" style={{ position: "relative" }}>
                    <button
                      className="status-pill"
                      onClick={() => setStatusOpen((o) => !o)}
                    >
                      <span
                        className="ring"
                        style={{
                          background: meta.status
                            ? STATUS_COLORS[meta.status]
                            : "var(--text-faint)",
                        }}
                      />
                      {meta.status ? STATUS_LABELS[meta.status] : "No status"}
                      <span className="caret">▾</span>
                    </button>
                    {statusOpen && (
                      <div className="status-menu">
                        <button onClick={() => setStatus(null)}>
                          <span
                            className="ring"
                            style={{ background: "var(--text-faint)" }}
                          />
                          None
                        </button>
                        {STATUS_ORDER.map((s) => (
                          <button key={s} onClick={() => setStatus(s)}>
                            <span
                              className="ring"
                              style={{ background: STATUS_COLORS[s] }}
                            />
                            {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <h1 className="ep-name">{meta.name}</h1>
                <div className="ep-subline">
                  {[meta.subtype, meta.district, meta.city]
                    .filter(Boolean)
                    .map((v, i) => (
                      <span key={i}>
                        {i > 0 && <span className="sep">·</span>}
                        {v}
                      </span>
                    ))}
                </div>

                {/* contact row */}
                <div className="ep-contact">
                  {meta.mail && (
                    <a href={`mailto:${meta.mail}`}>
                      <IconMail />
                      <span>{meta.mail}</span>
                    </a>
                  )}
                  {meta.phone && (
                    <a href={`tel:${String(meta.phone).replace(/\s/g, "")}`}>
                      <IconPhone />
                      <span>{meta.phone}</span>
                    </a>
                  )}
                  {meta.whatsapp && (
                    <a
                      href={`https://wa.me/${String(meta.whatsapp).replace(
                        /[^\d]/g,
                        ""
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <IconWhatsapp />
                      <span>{meta.whatsapp}</span>
                    </a>
                  )}
                  {meta.site && (
                    <a href={ext(meta.site)} target="_blank" rel="noreferrer">
                      <IconGlobe />
                      <span>Website</span>
                    </a>
                  )}
                  {meta.instagram && (
                    <a
                      href={`https://instagram.com/${String(
                        meta.instagram
                      ).replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <IconInstagram />
                      <span>Instagram</span>
                    </a>
                  )}
                  {meta.linkedin && (
                    <a href={ext(meta.linkedin)} target="_blank" rel="noreferrer">
                      <IconLinkedin />
                      <span>LinkedIn</span>
                    </a>
                  )}
                </div>

                {meta.hook && <div className="ep-hook">{meta.hook}</div>}
              </div>

              {/* score / closeness card */}
              <div className="ep-metrics">
                <div className="ep-metric">
                  <div className="k">Score</div>
                  <div className="v">{meta.score != null ? meta.score : "—"}</div>
                </div>
                {type === "person" && (
                  <div className="ep-metric">
                    <div className="k">Closeness</div>
                    <div className="v">
                      <span className="dots">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className={`d ${(meta.closeness ?? 0) > i ? "on" : ""}`}
                          />
                        ))}
                      </span>
                    </div>
                  </div>
                )}
                <div className="ep-metric">
                  <div className="k">Mails</div>
                  <div className="v">{entityMails.length}</div>
                </div>
              </div>
            </header>

            {/* tabs */}
            <nav className="ep-tabs tabs">
              {(
                [
                  ["overview", "Overview"],
                  ["mails", "Mails"],
                  ["activity", "Activity"],
                  ["note", "Note"],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={tab === k ? "on" : ""}
                  onClick={() => setTab(k)}
                >
                  {label}
                  {k === "mails" && entityMails.length > 0 && (
                    <span className="tab-badge">{entityMails.length}</span>
                  )}
                </button>
              ))}
            </nav>

            <div className="ep-body">
              {tab === "overview" && (
                <div className="ep-overview">
                  <div className="ep-col-main">
                    <section className="ep-sec">
                      <div className="ep-sec-title">Definition</div>
                      {definition ? (
                        <p className="ep-def">{definition}</p>
                      ) : (
                        <p className="ep-muted">No description yet</p>
                      )}
                    </section>

                    <section className="ep-sec">
                      <div className="ep-sec-title">
                        Relationships
                        <span className="ep-sec-count">
                          {relOut.length + relIn.length + mentions.length}
                        </span>
                      </div>
                      {relOut.length + relIn.length + mentions.length === 0 ? (
                        <p className="ep-muted">No relationships recorded.</p>
                      ) : (
                        <div className="ep-rels">
                          {relOut.map(RelRow)}
                          {relIn.map(RelRow)}
                          {mentions.length > 0 && (
                            <>
                              <div className="rel-group-label">Mentions</div>
                              {mentions.map(RelRow)}
                            </>
                          )}
                        </div>
                      )}
                    </section>
                  </div>

                  <div className="ep-col-side">
                    <section className="ep-sec">
                      <div className="ep-sec-title">Ego graph · 1 hop</div>
                      <EntityMiniGraph
                        data={graph}
                        centerId={id}
                        theme={theme}
                        onSelect={goto}
                      />
                    </section>
                  </div>
                </div>
              )}

              {tab === "mails" && (
                <div className="ep-mails">
                  {entityMails.length === 0 ? (
                    <div className="empty-state">
                      <div className="es-title">No mail activity yet</div>
                      <div className="es-sub">
                        As soon as you trade mail with {meta.name}, every
                        message shows up right here.
                      </div>
                    </div>
                  ) : (
                    <table className="grid mails-grid">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Direction</th>
                          <th>Subject</th>
                          <th>Summary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entityMails.map((m) => (
                          <tr key={m.id}>
                            <td className="mono">{m.date ?? "—"}</td>
                            <td>
                              <span className={`dir-tag ${m.direction}`}>
                                {m.direction === "out" ? "→ out" : "← in"}
                              </span>
                            </td>
                            <td>{m.subject ?? "—"}</td>
                            <td className="summary">{m.summary || m.raw || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {tab === "activity" && (
                <div className="empty-state">
                  <div className="es-title">Activity, coming soon</div>
                  <div className="es-sub">
                    Agent runs and git change history for this entity will land
                    here in V3b.
                  </div>
                </div>
              )}

              {tab === "note" && (
                <div className="ep-note">
                  {editing ? (
                    <div className="note-edit">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                      />
                      <div className="btn-row">
                        <button
                          className="btn primary"
                          onClick={saveBody}
                          disabled={saving}
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => setEditing(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="btn-row" style={{ marginBottom: 12 }}>
                        <button
                          className="btn ghost"
                          onClick={() => {
                            setDraft(stripFrontmatter(entity.body));
                            setEditing(true);
                          }}
                        >
                          Edit note
                        </button>
                      </div>
                      <div
                        className="md"
                        dangerouslySetInnerHTML={{ __html: bodyHtml }}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
