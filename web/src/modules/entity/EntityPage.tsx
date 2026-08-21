import { useEffect, useMemo, useState } from "react";
import type {
  Entity,
  GraphData,
  GraphNode,
  MailItem,
  Relation,
  Status,
} from "@/core/types";
import type { ThemeName } from "@/core/theme";
import {
  STATUS_LABELS,
  STATUS_ORDER,
  TYPE_ICONS,
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
import TeamPage from "./TeamPage";
import {
  competitionHistory,
  normalizeAuditIssues,
  normalizeConfidence,
  normalizeContacts,
  normalizeDrafts,
  normalizeEvidence,
  normalizeNotFound,
  normalizeProfileNote,
  normalizeSchoolStructure,
  normalizeProducts,
  normalizeSources,
  normalizeStringList,
  normalizeWarnings,
  wikilinkTarget,
} from "./structuredMeta";
import type { ProfileContact, ProfileSource } from "./structuredMeta";

type Tab = "overview" | "mails" | "activity" | "note";

interface Props {
  id: string;
  network: string;
  theme: ThemeName;
  onOpenMenu: () => void;
  onToggleTheme: () => void;
  mails: MailItem[] | null;
  graph: GraphData;
  onChanged: () => void;
  onOpenRelatedPeople: (entityId: string) => void;
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

function socialHref(channel: "linkedin" | "instagram", value: string): string {
  if (/^https?:\/\//u.test(value)) return value;
  if (channel === "linkedin") return ext(value);
  const handle = value.match(/@([\p{L}\p{N}._-]+)/u)?.[1] ?? value.replace(/^@/u, "");
  return `https://instagram.com/${handle}`;
}

function ProfileContactsBlock({ contacts }: { contacts: ProfileContact[] }) {
  return (
    <div className="profile-contacts" aria-label="Kaynaklı iletişim alanları">
      {contacts.map((contact) => {
        const Icon = contact.channel === "tel"
          ? IconPhone
          : contact.channel === "mail"
            ? IconMail
            : contact.channel === "linkedin"
              ? IconLinkedin
              : IconInstagram;
        const value = (
          <>
            <Icon />
            <span className="profile-contact-copy">
              {contact.estimated && <span className="estimated-badge">TAHMİN</span>}
              <span className="profile-contact-value">{contact.value}</span>
              <span className="profile-contact-source">↳ {contact.source}</span>
            </span>
          </>
        );
        return contact.channel === "linkedin" || contact.channel === "instagram" ? (
          <a
            className="profile-contact"
            key={contact.channel}
            href={socialHref(contact.channel, contact.value)}
            target="_blank"
            rel="noreferrer"
          >
            {value}
          </a>
        ) : (
          <div className="profile-contact" key={contact.channel}>{value}</div>
        );
      })}
    </div>
  );
}

function ProfileSourcesBlock({ sources }: { sources: ProfileSource[] }) {
  return (
    <section className="profile-sources" aria-labelledby="profile-sources-title">
      <div className="profile-sources-title" id="profile-sources-title">Kaynaklar</div>
      <div className="profile-source-list">
        {sources.map((source, index) => (
          <div className="profile-source" key={`${source.text}-${index}`}>
            {source.claim && <div className="profile-source-claim">{source.claim}</div>}
            <div className="profile-source-reference">
              <span aria-hidden>↳</span>{" "}
              {source.type === "acik" && source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">{source.text}</a>
              ) : (
                <span>{source.text}</span>
              )}
              {source.type === "ic" && (
                <span className="profile-internal-source">🔒 iç kaynak</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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
  network,
  theme,
  onOpenMenu,
  onToggleTheme,
  mails,
  graph,
  onChanged,
  onOpenRelatedPeople,
}: Props) {
  const TYPE_COLORS = typeColors(theme);
  const STATUS_COLORS = statusColors(theme);

  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [entityNotFound, setEntityNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [statusOpen, setStatusOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEntityNotFound(false);
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
        setEntityNotFound(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, network]);

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

  // Gerçek ilişkiler `connections`ta toplanıyor (aşağıda); burada kalan yalnız
  // "anılma" (mention) bağları — bağlantı bloğunun soluk alt şeridi.
  const mentions = useMemo(
    () => (entity?.relations ?? []).filter((r) => r.kind === "mention"),
    [entity]
  );

  // Definition, not gövdesinin ilk paragrafı — yani HAM MARKDOWN. Düz metin
  // olarak basılınca "**#24140 Lavender Robotics**" yıldızlarıyla görünüyordu
  // (Tuna, 21 Ağu). Gövdenin geri kalanıyla aynı boru hattından (renderMarkdown
  // → DOMPurify) geçiriyoruz; ayrı bir "yıldızları soy" mekanizması yok.
  const definitionHtml = useMemo(
    () => (entity ? renderMarkdown(firstParagraph(entity.body)) : ""),
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

  const products = useMemo(
    () => normalizeProducts(meta?.products),
    [meta?.products]
  );
  const awards = useMemo(
    () => normalizeStringList(meta?.awards),
    [meta?.awards]
  );
  const history = useMemo(
    () => competitionHistory(meta ?? {}),
    [meta]
  );
  const profileConfidence = useMemo(() => normalizeConfidence(meta?.guven), [meta?.guven]);
  const profileContacts: ProfileContact[] = useMemo(
    () => normalizeContacts(meta?.iletisim),
    [meta?.iletisim]
  );
  const purchases = useMemo(() => normalizeEvidence(meta?.robotik_alimlar), [meta?.robotik_alimlar]);
  const activities = useMemo(() => normalizeEvidence(meta?.aktiviteler), [meta?.aktiviteler]);
  const signals = useMemo(() => normalizeStringList(meta?.alim_sinyalleri), [meta?.alim_sinyalleri]);
  const internalData = useMemo(() => normalizeStringList(meta?.ic_veri), [meta?.ic_veri]);
  const hooks = useMemo(() => normalizeStringList(meta?.kanca_adaylari), [meta?.kanca_adaylari]);
  const notFound = useMemo(() => normalizeNotFound(meta?.bulunamayan), [meta?.bulunamayan]);
  const profileWarnings = useMemo(() => normalizeWarnings(meta?.uyarilar), [meta?.uyarilar]);
  const profileSources = useMemo(() => normalizeSources(meta?.kaynaklar), [meta?.kaynaklar]);
  const schoolStructure = useMemo(
    () => normalizeSchoolStructure(meta ?? {}),
    [meta]
  );
  const interviewQuestions = useMemo(
    () => normalizeStringList(meta?.gorusme_sorulari),
    [meta?.gorusme_sorulari]
  );
  const messageDrafts = useMemo(
    () => normalizeDrafts(meta?.mesaj_taslaklari),
    [meta?.mesaj_taslaklari]
  );
  const auditIssues = useMemo(
    () => normalizeAuditIssues(meta?.denetim_sorunlar),
    [meta?.denetim_sorunlar]
  );
  const purchaseScore = typeof meta?.alim_skoru === "number"
    ? meta.alim_skoru
    : meta?.score;
  const profileHook = typeof meta?.kanca === "string" && meta.kanca.trim()
    ? meta.kanca
    : meta?.hook;
  const profileStatus = typeof meta?.durum === "string" && meta.durum.trim()
    ? meta.durum
    : null;
  const primaryChannel = typeof meta?.birincil_kanal === "string" && meta.birincil_kanal.trim()
    ? meta.birincil_kanal
    : null;
  const policyStatus = meta?.politika_durumu === "no_contact" || meta?.politika_durumu === "defer"
    ? meta.politika_durumu
    : null;
  const policyText = typeof meta?.politika_metni === "string" && meta.politika_metni.trim()
    ? meta.politika_metni
    : null;
  const laneNote = normalizeProfileNote(meta?.kulvar_notu);
  const scanNote = normalizeProfileNote(meta?.tarama_notu);
  const connectedPeople = useMemo(() => {
    const people = new Map<string, Relation>();
    for (const relation of entity?.relations ?? []) {
      if (relation.type === "person") people.set(relation.id, relation);
    }
    return [...people.values()];
  }, [entity]);
  const teams = useMemo(() => {
    const linked = new Map<
      string,
      { id: string | null; name: string; direction?: Relation["direction"] }
    >();
    for (const relation of entity?.relations ?? []) {
      if (relation.type !== "team") continue;
      linked.set(`id:${relation.id}`, {
        id: relation.id,
        name: relation.name,
        direction: relation.direction,
      });
    }

    const teamNodes = graph.nodes.filter((node) => node.type === "team");
    for (const raw of normalizeStringList(meta?.teams)) {
      const target = wikilinkTarget(raw);
      const node = teamNodes.find(
        (candidate) => candidate.id === target || candidate.name === target
      );
      const key = node ? `id:${node.id}` : `name:${target}`;
      if (!linked.has(key)) {
        linked.set(key, { id: node?.id ?? null, name: node?.name ?? target });
      }
    }
    return [...linked.values()];
  }, [entity, graph.nodes, meta?.teams]);

  // Bağlantı kartçıkları: ilişkinin kendisi (id/ad/tip/etiket/yön) sunucunun
  // entityDetail'inden, yani vault gövdesindeki İlişkiler bölümünden doğan
  // edge'lerden geliyor. Rol/telefon/şehir ve temas politikası Relation
  // kaydında YOK; graf düğümünden (App'te entity listesiyle zenginleştirilmiş)
  // okunuyor. Düğüm bulunamazsa kart yine çizilir, sadece ek satırı olmaz.
  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graph.nodes) map.set(node.id, node);
    return map;
  }, [graph.nodes]);

  // Aynı hedefe giden ilişkiler TEK kartta toplanır. Karşılıklı yazılmış bir
  // bağ (A'nın notunda "bağlı olduğu kurum", B'nin notunda "kurumun takımı")
  // sunucudan iki ayrı edge olarak geliyordu ve liste aynı kurumu iki kez
  // basıyordu (Tuna, 21 Ağu). Kart hedefe göre tekilleşir, etiketler
  // birleştirilir; yön artık ayırt edici değil (bu yüzden ok da çizmiyoruz).
  const connections = useMemo(() => {
    const byTarget = new Map<string, { rel: Relation; labels: string[]; node?: GraphNode }>();
    for (const rel of entity?.relations ?? []) {
      if (rel.kind !== "relation") continue;
      const label = rel.label?.trim();
      const existing = byTarget.get(rel.id);
      if (existing) {
        if (label && !existing.labels.includes(label)) existing.labels.push(label);
        continue;
      }
      byTarget.set(rel.id, {
        rel,
        labels: label ? [label] : [],
        node: nodeById.get(rel.id),
      });
    }
    return [...byTarget.values()];
  }, [entity, nodeById]);

  const goto = (nid: string) => navigate(entityPath(nid, network));

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
        {entityNotFound ? (
          <div className="empty-state" style={{ marginTop: "16vh" }}>
            <div className="es-title">We couldn't find that entity</div>
            <div className="es-sub">
              Nothing with id <code>{id}</code> lives in this workspace.
            </div>
          </div>
        ) : loading || !entity || !meta ? (
          <div className="ep-loading">Loading…</div>
        ) : type === "team" ? (
          /* Takım kayıtları kendi sade ekranını kullanıyor (Tuna telefonda
             bunu açıyor): sekme/ego graph/skor kutusu yok. Diğer tipler
             aşağıdaki mevcut sayfada kalır. */
          <TeamPage entity={entity} nodeById={nodeById} onGoto={goto} />
        ) : (
          <>
            {policyStatus === "no_contact" && (
              <div className="no-contact-banner" role="alert">
                {policyText ?? "⛔ Temas yok"}
              </div>
            )}
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
                    <span className="ep-type-icon" aria-hidden>
                      {TYPE_ICONS[type]}
                    </span>
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
                  {type !== "person" && profileConfidence && (
                    <span className={`confidence-badge ${profileConfidence.level}`}>
                      {profileConfidence.raw}
                    </span>
                  )}
                  {type !== "person" && profileConfidence?.level === "tahmin" && (
                    <span className="confidence-warning">tahmin — gönderim kanalı değildir</span>
                  )}
                </div>

                <h1 className="ep-name">{meta.name}</h1>
                {(type === "school" || type === "institution") && profileStatus && (
                  <div className="profile-summary-row">
                    <span className="profile-neutral-chip">{profileStatus}</span>
                  </div>
                )}
                {type === "person" && (
                  <div className="profile-summary-row">
                    {profileStatus && <span className="profile-neutral-chip">{profileStatus}</span>}
                    {profileConfidence && (
                      <span className={`confidence-badge ${profileConfidence.level}`}>
                        {profileConfidence.raw}
                      </span>
                    )}
                    {primaryChannel && (
                      <span className="profile-neutral-chip">birincil kanal: {primaryChannel}</span>
                    )}
                    {policyStatus === "defer" && (
                      <span className="profile-policy-defer">{policyText ?? "⏸ Temas ertelendi"}</span>
                    )}
                  </div>
                )}
                {type === "person" && profileConfidence?.level === "tahmin" && (
                  <div className="confidence-warning profile-confidence-warning">
                    tahmin — gönderim kanalı değildir
                  </div>
                )}
                {type === "person" && profileSources.length > 0 && (
                  <ProfileSourcesBlock sources={profileSources} />
                )}
                {type === "person" && (meta.robotik_rol || meta.kaynak_tipi) && (
                  <div className="profile-meta-line">
                    {typeof meta.robotik_rol === "string" && meta.robotik_rol.trim() && (
                      <span><span className="profile-meta-label">Robotik rol:</span> {meta.robotik_rol}</span>
                    )}
                    {typeof meta.kaynak_tipi === "string" && meta.kaynak_tipi.trim() && (
                      <span><span className="profile-meta-label">Kaynak tipi:</span> {meta.kaynak_tipi}</span>
                    )}
                  </div>
                )}
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

                {profileContacts.length > 0 && <ProfileContactsBlock contacts={profileContacts} />}

                {profileHook && <div className="ep-hook">{profileHook}</div>}
              </div>

              {/* score / closeness card */}
              <div className="ep-metrics">
                <div className="ep-metric">
                  <div className="k">{meta.alim_skoru != null ? "Alım skoru" : "Score"}</div>
                  <div className="v">{purchaseScore != null ? purchaseScore : "—"}</div>
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
                {(type === "school" || type === "institution") && (
                  <button
                    className="ep-metric ep-metric-link"
                    onClick={() => onOpenRelatedPeople(entity.id)}
                    title="Bağlı kişileri listele"
                  >
                    <span className="k">Kişiler</span>
                    <span className="v">{connectedPeople.length} kişi</span>
                  </button>
                )}
                <div className="ep-metric">
                  <div className="k">Mails</div>
                  <div className="v">{entityMails.length}</div>
                </div>
              </div>
            </header>

            {/* Bağlantılar — sayfanın en önemli bloğu (Tuna, 21 Ağu):
                kimlik şeridinin hemen altında, sekmelerin ÜSTÜNDE, yani hangi
                sekmede olursan ol görünür. İlişkisi olmayan kayıtta hiç
                çizilmez, o yüzden diğer ağlarda da fazlalık yapmaz. */}
            {(connections.length > 0 || mentions.length > 0) && (
              <section className="ep-connections">
                <div className="ep-sec-title">
                  Bağlantılar
                  <span className="ep-sec-count">{connections.length}</span>
                </div>
                {connections.length > 0 && (
                  <div className="ep-conn-grid">
                    {connections.map(({ rel, labels, node }) => {
                      const blocked =
                        node?.politika_durumu === "no_contact" ||
                        Boolean(node?.flags?.no_contact);
                      const deferred = node?.politika_durumu === "defer";
                      const extras =
                        rel.type === "person"
                          ? [node?.role, node?.phone]
                          : [node?.city];
                      const detail = extras.filter(Boolean) as string[];
                      return (
                        <button
                          key={rel.id}
                          className={`ep-conn${blocked || deferred ? " dim" : ""}`}
                          onClick={() => goto(rel.id)}
                          title={node?.politika_metni ?? rel.name}
                        >
                          <span className="ep-conn-head">
                            <span
                              className="ep-conn-type"
                              style={{
                                background: `${TYPE_COLORS[rel.type]}1f`,
                                color: TYPE_COLORS[rel.type],
                              }}
                            >
                              <span
                                className="swatch"
                                style={{ background: TYPE_COLORS[rel.type] }}
                              />
                              {TYPE_LABELS[rel.type]}
                            </span>
                            {blocked && (
                              <span className="ep-conn-flag" title="Temas yok">
                                ⛔
                              </span>
                            )}
                            {deferred && (
                              <span
                                className="ep-conn-flag"
                                title="Temas ertelendi"
                              >
                                ⏸️
                              </span>
                            )}
                          </span>
                          <span className="ep-conn-name">{rel.name}</span>
                          {detail.length > 0 && (
                            <span className="ep-conn-detail">
                              {detail.join(" · ")}
                            </span>
                          )}
                          {labels.length > 0 && (
                            <span className="ep-conn-label">
                              {labels.join(" · ")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {mentions.length > 0 && (
                  <div className="ep-conn-mentions">
                    <div className="rel-group-label">Anılanlar</div>
                    <div className="ep-rels">{mentions.map(RelRow)}</div>
                  </div>
                )}
              </section>
            )}

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
                      {definitionHtml ? (
                        <div
                          className="ep-def md"
                          dangerouslySetInnerHTML={{ __html: definitionHtml }}
                        />
                      ) : (
                        <p className="ep-muted">No description yet</p>
                      )}
                    </section>

                    {(type === "school" || type === "institution") && schoolStructure.length > 0 && (
                      <section className="ep-sec school-structure">
                        <div className="ep-sec-title">Yapı</div>
                        <dl className="school-structure-list">
                          {schoolStructure.map((row) => (
                            <div className="school-structure-row" key={row.key}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    )}

                    {(laneNote || scanNote) && (
                      <div className="profile-note-stack">
                        {laneNote && (
                          <div className="profile-context-note profile-lane-note">{laneNote}</div>
                        )}
                        {scanNote && (
                          <div className="profile-context-note profile-scan-note">{scanNote}</div>
                        )}
                      </div>
                    )}

                    {purchases.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Robotik alımlar</div>
                        <div className="profile-evidence-list">
                          {purchases.map((item, index) => (
                            <div className="profile-evidence" key={`${item.text}-${index}`}>
                              {item.date && <span className="profile-evidence-date">{item.date}</span>}
                              <div>{item.text}</div>
                              {item.source && <div className="profile-evidence-source">↳ {item.source}</div>}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {activities.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Aktiviteler</div>
                        <div className="profile-evidence-list">
                          {activities.map((item, index) => (
                            <div className="profile-evidence" key={`${item.text}-${index}`}>
                              {item.date && <span className="profile-evidence-date">{item.date}</span>}
                              <div>{item.text}</div>
                              {item.source && <div className="profile-evidence-source">↳ {item.source}</div>}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {internalData.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">İç veri</div>
                        <ul className="profile-list">
                          {internalData.map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </section>
                    )}

                    {signals.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Alım sinyalleri</div>
                        <ul className="profile-list">
                          {signals.map((signal) => <li key={signal}>{signal}</li>)}
                        </ul>
                      </section>
                    )}

                    {hooks.length > 0 && (
                      <details className="ep-sec profile-hooks">
                        <summary className="ep-sec-title">
                          Kanca adayları — DOĞRULANMAMIŞ, mesaja olduğu gibi girmez
                        </summary>
                        <div className="profile-hook-note">
                          Doğrulanmamış. Kanca bir KONU BAŞLIĞIDIR, hazır cümle değil — bilgi övgüye değil soruya çevrilir.
                          {meta.onay === false && " · paketin denetim alanı: onay=false"}
                        </div>
                        <ul className="profile-list">
                          {hooks.map((hook) => <li key={hook}>{hook}</li>)}
                        </ul>
                      </details>
                    )}

                    {notFound.length > 0 && (
                      <section className="ep-sec profile-not-found">
                        <div className="ep-sec-title">Bu turda çıkmayanlar</div>
                        <ul className="profile-list profile-not-found-list">
                          {notFound.map((item, index) => (
                            <li key={`${item.text}-${index}`}>
                              <span>{item.text}</span>
                              {item.type === "bulunamadi" && (
                                <span className="not-found-tag searched">arandı, çıkmadı</span>
                              )}
                              {item.type === "bakilamadi" && (
                                <span className="not-found-tag retry">🔄 bakılamadı — yeniden taranmalı</span>
                              )}
                              {item.type === "aranmadi" && (
                                <span className="not-found-tag skipped">kural gereği aranmadı</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {profileWarnings.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Uyarılar</div>
                        <div className="profile-warning-list">
                          {profileWarnings.map((warning, index) => (
                            <div
                              className={`profile-warning ${warning.tone}`}
                              key={`${warning.text}-${index}`}
                            >
                              {warning.text}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {typeof meta.temas_plani === "string" && meta.temas_plani.trim() && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Temas planı</div>
                        <p className="profile-plan">{meta.temas_plani}</p>
                      </section>
                    )}

                    {interviewQuestions.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Mom-Test soruları</div>
                        <ol className="profile-list numbered">
                          {interviewQuestions.map((question) => <li key={question}>{question}</li>)}
                        </ol>
                      </section>
                    )}

                    {messageDrafts.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Mesaj taslakları</div>
                        <p className="draft-approval-note">Gönderim = Tuna'nın tek tek onayı</p>
                        <div className="profile-drafts">
                          {messageDrafts.map((draft, index) => (
                            <details className="profile-draft" key={`${draft.person}-${draft.channel}-${index}`}>
                              <summary>
                                <span className="draft-badge">TASLAK</span>
                                {draft.person && <span>{draft.person}</span>}
                                <span>{draft.channel}</span>
                                {draft.corrected && <span className="audited-badge">denetimden geçti</span>}
                              </summary>
                              {draft.subject && <div className="profile-draft-subject">Konu: {draft.subject}</div>}
                              <div className="profile-draft-text">{draft.text}</div>
                            </details>
                          ))}
                        </div>
                      </section>
                    )}

                    {auditIssues.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Denetim sorunları</div>
                        <div className="audit-issues">
                          {auditIssues.map((issue, index) => (
                            <div className={`audit-issue ${issue.clean ? "clean" : "warning"}`} key={`${issue.type}-${index}`}>
                              <div>
                                <span className="audit-type">{issue.type}</span>
                                {issue.person && <span className="audit-person">{issue.person}</span>}
                              </div>
                              <div>{issue.description}</div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {products.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Ürünler</div>
                        <div className="ep-table-wrap">
                          <table className="grid ep-products">
                            <thead>
                              <tr>
                                <th>Ad</th>
                                <th>Fiyat</th>
                                <th>Para birimi</th>
                                <th>Bağlantı</th>
                                <th>Not</th>
                              </tr>
                            </thead>
                            <tbody>
                              {products.map((product, index) => (
                                <tr key={`${product.name}-${index}`}>
                                  <td className="ep-product-name">
                                    <span>{product.name}</span>
                                    {product.top_seller && (
                                      <span className="ep-badge">Çok satan</span>
                                    )}
                                  </td>
                                  <td className="num">{product.price ?? "—"}</td>
                                  <td>{product.currency ?? "—"}</td>
                                  <td>
                                    {product.url ? (
                                      <a
                                        href={ext(product.url)}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Aç ↗
                                      </a>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="ep-product-note">
                                    {product.note ?? "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}

                    {awards.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Ödüller</div>
                        <ul className="ep-awards">
                          {awards.map((award) => (
                            <li key={award}>{award}</li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {history && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">Yarışma geçmişi</div>
                        <div className="ep-history">{history}</div>
                      </section>
                    )}

                    {teams.length > 0 && (
                      <section className="ep-sec">
                        <div className="ep-sec-title">
                          Takımlar
                          <span className="ep-sec-count">{teams.length}</span>
                        </div>
                        <div className="ep-rels">
                          {teams.map((team) =>
                            team.id ? (
                              <button
                                key={team.id}
                                className="rel"
                                onClick={() => goto(team.id!)}
                              >
                                <span className="dir">
                                  {team.direction === "in" ? "←" : "→"}
                                </span>
                                <span
                                  className="swatch"
                                  style={{ background: TYPE_COLORS.team }}
                                />
                                <span className="r-name">{team.name}</span>
                              </button>
                            ) : (
                              <div
                                key={team.name}
                                className="rel ep-team-unresolved"
                              >
                                <span className="dir">—</span>
                                <span
                                  className="swatch"
                                  style={{ background: TYPE_COLORS.team }}
                                />
                                <span className="r-name">{team.name}</span>
                              </div>
                            )
                          )}
                        </div>
                      </section>
                    )}

                    {/* İlişkiler artık sayfanın üstündeki "Bağlantılar"
                        bölümünde; burada ikinci bir liste tutulmuyor. */}
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
