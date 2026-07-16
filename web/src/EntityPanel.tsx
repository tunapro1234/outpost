import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import type { Entity, Relation, Status } from "./types";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_ORDER,
  TYPE_COLORS,
  TYPE_LABELS,
} from "./theme";
import { api } from "./api";
import {
  IconGlobe,
  IconInstagram,
  IconLinkedin,
  IconMail,
  IconPhone,
  IconWhatsapp,
} from "./icons";

marked.setOptions({ breaks: true });

interface Props {
  id: string;
  onClose: () => void;
  onGoto: (id: string) => void;
  onChanged: () => void;
}

function stripFrontmatter(body: string): string {
  return body.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function ext(url: string): string {
  if (!url) return url;
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

export default function EntityPanel({ id, onClose, onGoto, onChanged }: Props) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEditing(false);
    setStatusOpen(false);
    api
      .entity(id)
      .then((e) => {
        if (alive) {
          setEntity(e);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
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

  const { relOut, relIn, mentions, unresolved } = useMemo(() => {
    const rels = entity?.relations ?? [];
    return {
      relOut: rels.filter((r) => r.kind === "relation" && r.direction === "out"),
      relIn: rels.filter((r) => r.kind === "relation" && r.direction === "in"),
      mentions: rels.filter((r) => r.kind === "mention"),
      unresolved: entity?.unresolved ?? [],
    };
  }, [entity]);

  const bodyHtml = useMemo(() => {
    if (!entity) return "";
    return marked.parse(stripFrontmatter(entity.body)) as string;
  }, [entity]);

  const RelRow = (r: Relation) => (
    <button key={`${r.direction}-${r.id}`} className="rel" onClick={() => onGoto(r.id)}>
      <span className="dir">{r.direction === "out" ? "→" : "←"}</span>
      <span
        className="swatch"
        style={{ background: TYPE_COLORS[r.type] }}
      />
      <span className="r-name">{r.name}</span>
      {r.label && <span className="r-label">{r.label}</span>}
    </button>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <button className="panel-close" onClick={onClose} title="Kapat (Esc)">
          ✕
        </button>
        {loading || !meta ? (
          <>
            <div className="panel-type" style={{ background: "#16203a" }}>
              yükleniyor
            </div>
            <h1>&nbsp;</h1>
          </>
        ) : (
          <>
            <div
              className="panel-type"
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
            </div>
            <h1>{meta.name}</h1>
            <div className="subline">
              {[meta.subtype, meta.city, meta.district]
                .filter(Boolean)
                .map((v, i) => (
                  <span key={i}>
                    {i > 0 && <span className="sep">·</span>}
                    {v}
                  </span>
                ))}
            </div>
          </>
        )}
      </div>

      {loading || !entity || !meta ? (
        <div className="panel-body" />
      ) : (
        <div className="panel-body">
          {/* status + score */}
          <div className="sec">
            <div className="sec-title">Durum</div>
            <div style={{ position: "relative" }}>
              <button
                className="status-pill"
                onClick={() => setStatusOpen((o) => !o)}
              >
                <span
                  className="ring"
                  style={{
                    background: meta.status
                      ? STATUS_COLORS[meta.status]
                      : "#3a4763",
                  }}
                />
                {meta.status ? STATUS_LABELS[meta.status] : "Durum yok"}
                <span className="caret">▾</span>
              </button>
              {statusOpen && (
                <div className="status-menu">
                  <button onClick={() => setStatus(null)}>
                    <span className="ring" style={{ background: "#3a4763" }} />
                    Yok
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

            <div className="stat-row" style={{ marginTop: 12 }}>
              <div className="stat-box">
                <div className="k">Skor</div>
                <div className="v">
                  {meta.score != null ? meta.score : "—"}
                </div>
              </div>
              {type === "person" && (
                <div className="stat-box">
                  <div className="k">Yakınlık</div>
                  <div className="v" style={{ paddingTop: 4 }}>
                    <span className="dots">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={`d ${
                            (meta.closeness ?? 0) > i ? "on" : ""
                          }`}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* hook */}
          {meta.hook && (
            <div className="sec">
              <div className="sec-title">Kanca</div>
              <div className="hook">{meta.hook}</div>
            </div>
          )}

          {/* contact */}
          {(meta.mail ||
            meta.phone ||
            meta.whatsapp ||
            meta.site ||
            meta.instagram ||
            meta.linkedin) && (
            <div className="sec">
              <div className="sec-title">İletişim</div>
              <div className="contact">
                {meta.mail && (
                  <a href={`mailto:${meta.mail}`}>
                    <span className="c-ico">
                      <IconMail />
                    </span>
                    <span className="c-val">{meta.mail}</span>
                    {meta.mail_source && meta.mail_source !== "yok" && (
                      <span className="c-tag">{meta.mail_source}</span>
                    )}
                  </a>
                )}
                {meta.phone && (
                  <a href={`tel:${String(meta.phone).replace(/\s/g, "")}`}>
                    <span className="c-ico">
                      <IconPhone />
                    </span>
                    <span className="c-val">{meta.phone}</span>
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
                    <span className="c-ico">
                      <IconWhatsapp />
                    </span>
                    <span className="c-val">{meta.whatsapp}</span>
                  </a>
                )}
                {meta.site && (
                  <a href={ext(meta.site)} target="_blank" rel="noreferrer">
                    <span className="c-ico">
                      <IconGlobe />
                    </span>
                    <span className="c-val">{meta.site}</span>
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
                    <span className="c-ico">
                      <IconInstagram />
                    </span>
                    <span className="c-val">{meta.instagram}</span>
                  </a>
                )}
                {meta.linkedin && (
                  <a href={ext(meta.linkedin)} target="_blank" rel="noreferrer">
                    <span className="c-ico">
                      <IconLinkedin />
                    </span>
                    <span className="c-val">{meta.linkedin}</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* relations */}
          {(relOut.length > 0 ||
            relIn.length > 0 ||
            mentions.length > 0 ||
            unresolved.length > 0) && (
            <div className="sec">
              <div className="sec-title">İlişkiler</div>
              {relOut.map(RelRow)}
              {relIn.map(RelRow)}
              {mentions.length > 0 && (
                <>
                  <div className="rel-group-label">Bahsedilenler</div>
                  {mentions.map(RelRow)}
                </>
              )}
              {unresolved.length > 0 && (
                <>
                  <div className="rel-group-label">Çözülemeyen</div>
                  {unresolved.map((u) => (
                    <div key={u} className="unresolved-item">
                      {u}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* note / body */}
          <div className="sec">
            <div className="sec-title">Not</div>
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
                    {saving ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => setEditing(false)}
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="md"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
                <div className="btn-row">
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setDraft(stripFrontmatter(entity.body));
                      setEditing(true);
                    }}
                  >
                    Notu düzenle
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
