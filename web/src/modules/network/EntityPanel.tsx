import { useEffect, useMemo, useState } from "react";
import type {
  Entity,
  Interaction,
  InteractionChannel,
  InteractionDirection,
  OutreachState,
  Relation,
  Status,
} from "@/core/types";
import type { ThemeName } from "@/core/theme";
import {
  STATUS_LABELS,
  STATUS_ORDER,
  OUTREACH_STATE_LABELS,
  OUTREACH_STATE_ORDER,
  TYPE_LABELS,
  outreachStateColors,
  statusColors,
  typeColors,
} from "@/core/theme";
import { api } from "@/core/api";
import { renderMarkdown } from "@/core/markdown";
import {
  IconGlobe,
  IconInstagram,
  IconLinkedin,
  IconMail,
  IconPhone,
  IconWhatsapp,
} from "@/core/icons";

interface Props {
  id: string;
  theme: ThemeName;
  onClose: () => void;
  onGoto: (id: string) => void;
  onOpenFull: (id: string) => void;
  onChanged: () => void;
  onEgo: (id: string) => void;
  onHide: (id: string) => void;
  egoActive: boolean;
  onStateChange: (
    id: string,
    state: OutreachState | null,
    source?: "manual" | "derived"
  ) => void;
}

function stripFrontmatter(body: string): string {
  return body.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function ext(url: string): string {
  if (!url) return url;
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function whatsappNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = `90${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
  return digits.length >= 10 ? digits : null;
}

const CHANNEL_LABELS: Record<InteractionChannel, string> = {
  whatsapp: "WhatsApp",
  mail: "Mail",
  telefon: "Telefon",
  yuzyuze: "Yüz yüze",
  diger: "Diğer",
};

const CHANNEL_ICONS: Record<InteractionChannel, string> = {
  whatsapp: "◉",
  mail: "@",
  telefon: "☎",
  yuzyuze: "◇",
  diger: "·",
};

export default function EntityPanel({
  id,
  theme,
  onClose,
  onGoto,
  onOpenFull,
  onChanged,
  onEgo,
  onHide,
  egoActive,
  onStateChange,
}: Props) {
  const TYPE_COLORS = typeColors(theme);
  const STATUS_COLORS = statusColors(theme);
  const OUTREACH_COLORS = outreachStateColors(theme);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [interactionsLoading, setInteractionsLoading] = useState(true);
  const [interactionSaving, setInteractionSaving] = useState(false);
  const [deletingInteraction, setDeletingInteraction] = useState<number | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [channel, setChannel] = useState<InteractionChannel>("whatsapp");
  const [direction, setDirection] = useState<InteractionDirection>("out");
  const [interactionNote, setInteractionNote] = useState("");
  const [interactionAt, setInteractionAt] = useState(localDateTimeValue);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEditing(false);
    setStatusOpen(false);
    setPanelError(null);
    setInteractionsLoading(true);
    Promise.all([
      api.entity(id),
      api.interactions(id).catch(() => [] as Interaction[]),
    ])
      .then(([e, items]) => {
        if (alive) {
          setEntity(e);
          setInteractions(items);
          setLoading(false);
          setInteractionsLoading(false);
        }
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
        setInteractionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const meta = entity?.meta;
  const type = meta?.type ?? "company";
  const waNumber = whatsappNumber(meta?.whatsapp ?? meta?.phone);

  const setStatus = async (s: Status | null) => {
    if (!entity) return;
    setStatusOpen(false);
    const updated = await api.patchEntity(entity.id, { meta: { status: s } });
    setEntity(updated);
    onChanged();
  };

  const setOutreachState = async (next: OutreachState) => {
    if (!entity || saving) return;
    const previous = entity.state ?? null;
    const previousSource = entity.state_source;
    setPanelError(null);
    setSaving(true);
    setEntity({ ...entity, state: next, state_source: "manual" });
    onStateChange(entity.id, next, "manual");
    try {
      const updated = await api.updateEntityStatus(entity.id, next);
      setEntity((current) =>
        current
          ? {
              ...current,
              state: updated.state,
              state_source: updated.state_source,
              research_status: updated.research_status,
              flags: updated.flags ?? current.flags,
            }
          : current
      );
      onStateChange(
        entity.id,
        updated.state ?? null,
        updated.state_source ?? "manual"
      );
    } catch (error) {
      setEntity((current) =>
        current
          ? { ...current, state: previous, state_source: previousSource }
          : current
      );
      onStateChange(entity.id, previous, previousSource);
      setPanelError(error instanceof Error ? error.message : "Durum kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  const refreshEntityState = async (entityId: string) => {
    try {
      const refreshed = await api.entity(entityId);
      setEntity(refreshed);
      onStateChange(
        entityId,
        refreshed.state ?? null,
        refreshed.state_source ?? "derived"
      );
    } catch {
      // The interaction itself succeeded; the normal App refresh below will
      // reconcile state even if this convenience read briefly fails.
    }
  };

  const saveInteraction = async () => {
    if (!entity || interactionSaving) return;
    setPanelError(null);
    setInteractionSaving(true);
    try {
      const created = await api.createInteraction(entity.id, {
        channel,
        direction,
        at: new Date(interactionAt).toISOString(),
        ...(interactionNote.trim() ? { note: interactionNote.trim() } : {}),
      });
      setInteractions((current) =>
        [...current, created].sort(
          (left, right) => Date.parse(right.at) - Date.parse(left.at)
        )
      );
      await refreshEntityState(entity.id);
      setInteractionNote("");
      setInteractionAt(localDateTimeValue());
      onChanged();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Temas kaydedilemedi");
    } finally {
      setInteractionSaving(false);
    }
  };

  const removeInteraction = async (interactionId: number) => {
    if (!entity || deletingInteraction !== null) return;
    setPanelError(null);
    setDeletingInteraction(interactionId);
    try {
      await api.deleteInteraction(entity.id, interactionId);
      setInteractions((current) =>
        current.filter((interaction) => interaction.id !== interactionId)
      );
      await refreshEntityState(entity.id);
      onChanged();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Temas silinemedi");
    } finally {
      setDeletingInteraction(null);
    }
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
    return renderMarkdown(stripFrontmatter(entity.body));
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
            <div className="panel-type" style={{ background: "var(--surface-2)" }}>
              loading
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
          <div className="panel-actions">
            <button
              className="btn primary open-full"
              onClick={() => onOpenFull(entity.id)}
            >
              Open full page →
            </button>
            <button
              className={`btn ego-btn ${egoActive ? "on" : ""}`}
              onClick={() => onEgo(entity.id)}
            >
              {egoActive ? "Neighborhood active" : "Show only its neighborhood"}
            </button>
            <button
              className="btn graph-hide-btn"
              onClick={() => onHide(entity.id)}
            >
              Grafikte gizle
            </button>
          </div>

          {panelError && (
            <div className="panel-inline-error" role="alert">
              {panelError}
            </div>
          )}

          <div className="sec">
            <div className="sec-title">İletişim durumu</div>
            <label className="outreach-state-field">
              <span
                className="outreach-state-dot"
                style={{ background: OUTREACH_COLORS[entity.state ?? 0] }}
              />
              <select
                value={entity.state ?? 0}
                onChange={(event) =>
                  setOutreachState(Number(event.target.value) as OutreachState)
                }
                disabled={saving}
                aria-label="İletişim durumu"
              >
                {OUTREACH_STATE_ORDER.map((state) => (
                  <option key={state} value={state}>
                    {state} · {OUTREACH_STATE_LABELS[state]}
                  </option>
                ))}
              </select>
            </label>
            <div className="outreach-state-source">
              {saving
                ? "Kaydediliyor…"
                : entity.state_source === "manual"
                ? "Manuel durum"
                : "Verilerden türetildi"}
            </div>
          </div>

          {/* status + score */}
          <div className="sec">
            <div className="sec-title">Status</div>
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

            <div className="stat-row" style={{ marginTop: 12 }}>
              <div className="stat-box">
                <div className="k">Score</div>
                <div className="v">
                  {meta.score != null ? meta.score : "—"}
                </div>
              </div>
              {type === "person" && (
                <div className="stat-box">
                  <div className="k">Closeness</div>
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
              <div className="sec-title">Hook</div>
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
              <div className="sec-title">Contact</div>
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
                {waNumber && (
                  <a
                    href={`https://wa.me/${waNumber}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="c-ico">
                      <IconWhatsapp />
                    </span>
                    <span className="c-val">WhatsApp'ta aç</span>
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

          <div className="sec">
            <div className="sec-title">Temas kaydet</div>
            <div className="interaction-form">
              <div className="interaction-form-row">
                <label>
                  <span>Kanal</span>
                  <select
                    value={channel}
                    onChange={(event) =>
                      setChannel(event.target.value as InteractionChannel)
                    }
                  >
                    {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Yön</span>
                  <select
                    value={direction}
                    onChange={(event) =>
                      setDirection(event.target.value as InteractionDirection)
                    }
                  >
                    <option value="out">Giden</option>
                    <option value="in">Gelen</option>
                  </select>
                </label>
              </div>
              <label>
                <span>Tarih</span>
                <input
                  type="datetime-local"
                  value={interactionAt}
                  onChange={(event) => setInteractionAt(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Not</span>
                <textarea
                  value={interactionNote}
                  onChange={(event) => setInteractionNote(event.target.value)}
                  rows={3}
                  placeholder="Kısa temas notu"
                />
              </label>
              <button
                className="btn primary"
                onClick={saveInteraction}
                disabled={interactionSaving || !interactionAt}
              >
                {interactionSaving ? "Kaydediliyor…" : "Teması kaydet"}
              </button>
            </div>
          </div>

          <div className="sec">
            <div className="sec-title">Temas zaman çizelgesi</div>
            {interactionsLoading ? (
              <div className="interaction-empty">Yükleniyor…</div>
            ) : interactions.length === 0 ? (
              <div className="interaction-empty">Henüz temas kaydı yok.</div>
            ) : (
              <div className="interaction-timeline">
                {interactions.map((interaction) => (
                  <div className="interaction-item" key={interaction.id}>
                    <span
                      className={`interaction-channel ${interaction.channel}`}
                      aria-hidden
                    >
                      {CHANNEL_ICONS[interaction.channel]}
                    </span>
                    <div className="interaction-main">
                      <div className="interaction-title">
                        {CHANNEL_LABELS[interaction.channel]}
                        <span>
                          {interaction.direction === "in" ? "Gelen" : "Giden"}
                        </span>
                      </div>
                      <time dateTime={interaction.at}>
                        {new Date(interaction.at).toLocaleString("tr-TR")}
                      </time>
                      {interaction.note && <p>{interaction.note}</p>}
                    </div>
                    <button
                      className="interaction-delete"
                      onClick={() => removeInteraction(interaction.id)}
                      disabled={deletingInteraction !== null}
                      title="Teması sil"
                      aria-label="Teması sil"
                    >
                      {deletingInteraction === interaction.id ? "…" : "✕"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* relations */}
          {(relOut.length > 0 ||
            relIn.length > 0 ||
            mentions.length > 0 ||
            unresolved.length > 0) && (
            <div className="sec">
              <div className="sec-title">Relations</div>
              {relOut.map(RelRow)}
              {relIn.map(RelRow)}
              {mentions.length > 0 && (
                <>
                  <div className="rel-group-label">Mentions</div>
                  {mentions.map(RelRow)}
                </>
              )}
              {unresolved.length > 0 && (
                <>
                  <div className="rel-group-label">Unresolved</div>
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
            <div className="sec-title">Note</div>
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
                    Edit note
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
