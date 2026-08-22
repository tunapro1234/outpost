import { TYPE_DIRECTORIES } from "../../lib/vault.mjs";
import { ENTITY_TYPES } from "../../lib/entity-meta.mjs";
import { openWorkspaceDb } from "../../lib/db.mjs";
import { normalizeSearch } from "../../lib/slug.mjs";
import { extractMailAddresses } from "../mail/parser.mjs";
import { emptyMailStats } from "../reach/mails.mjs";

export const VALID_TYPES = new Set(ENTITY_TYPES);
const DURUM_STATES = new Map([
  ["yeni", 0],
  ["izlemede", 0],
  ["siniflandirma-bekliyor", 0],
  ["pasif", 0],
  ["yazilacak", 1],
  ["konusuldu", 3],
  ["referans-verdi", 3],
  ["aktif", 4],
]);

function emptyFlags() {
  return { internal: false, no_contact: false };
}

function profileScore(meta = {}) {
  if (typeof meta.score === "number" && Number.isFinite(meta.score)) return meta.score;
  if (typeof meta.alim_skoru === "number" && Number.isFinite(meta.alim_skoru)) {
    return meta.alim_skoru;
  }
  return null;
}

function profileConfidence(meta = {}) {
  if (typeof meta.guven === "string") return meta.guven;
  if (meta.guven && typeof meta.guven === "object" && !Array.isArray(meta.guven)) {
    return meta.guven.sinif ?? meta.guven.ham ?? null;
  }
  return null;
}

export function workspaceNetworkId(workspace) {
  return workspace.networkId ?? workspace.defaultNetworkId ?? "default";
}

/**
 * The one state-derivation function used by graph, list, detail, status-map,
 * and Overview. A manual value is an override. Everything else is evidence:
 * interactions and matched mail raise the state, then `durum` supplies a
 * baseline. Safety classifications deliberately have no outreach state.
 */
export function deriveEntityState({
  entity,
  status = null,
  interaction = null,
  mail = null,
} = {}) {
  const durum = typeof entity?.meta?.durum === "string"
    ? entity.meta.durum.trim().toLowerCase()
    : "";
  const flags = emptyFlags();
  if (entity?.meta?.flags && typeof entity.meta.flags === "object") {
    flags.internal = entity.meta.flags.internal === true;
    flags.no_contact = entity.meta.flags.no_contact === true;
  }
  if (durum === "ic") flags.internal = true;
  if (durum === "temas-yasak") flags.no_contact = true;

  const researchStatus = status?.research_status ?? "none";
  if (flags.internal || flags.no_contact) {
    return {
      state: null,
      state_source: "derived",
      research_status: researchStatus,
      flags,
    };
  }

  if (
    status?.state_source === "manual" &&
    Number.isInteger(status.outreach_state)
  ) {
    return {
      state: status.outreach_state,
      state_source: "manual",
      research_status: researchStatus,
      flags,
    };
  }

  let state = DURUM_STATES.get(durum) ?? 0;
  if (mail?.out) state = Math.max(state, 2);
  if (mail?.in) state = Math.max(state, 3);
  if (interaction?.out) state = Math.max(state, 2);
  if (interaction?.in) state = Math.max(state, 3);
  return {
    state,
    state_source: "derived",
    research_status: researchStatus,
    flags,
  };
}

function evidence(map, entityId) {
  let value = map.get(entityId);
  if (!value) {
    value = { out: false, in: false };
    map.set(entityId, value);
  }
  return value;
}

/**
 * Load every DB/mail input once and derive all entities in a network. Callers
 * may pass the already-loaded traffic mail list to avoid duplicate I/O.
 */
export function entityStateMap(workspace, mails = []) {
  const db = openWorkspaceDb(workspace);
  const network = workspaceNetworkId(workspace);
  const statusByEntity = new Map(
    db.prepare(
      `SELECT * FROM entity_status
       WHERE workspace = ? AND network = ?`,
    ).all(workspace.id, network).map((row) => [row.entity_id, row]),
  );
  const interactionByEntity = new Map();
  for (const row of db.prepare(
    `SELECT entity_id, direction FROM interaction
     WHERE workspace = ? AND network = ?`,
  ).all(workspace.id, network)) {
    evidence(interactionByEntity, row.entity_id)[row.direction] = true;
  }

  const mailByEntity = new Map();
  for (const mail of mails) {
    if (!mail?.entity_id || !["out", "in"].includes(mail.direction)) continue;
    evidence(mailByEntity, mail.entity_id)[mail.direction] = true;
    if (mail.person_id) evidence(mailByEntity, mail.person_id)[mail.direction] = true;
  }
  for (const row of db.prepare(
    `SELECT m.person_id, m.company_id
     FROM mail_send AS s
     JOIN mail AS m ON m.id = s.mail_id
     WHERE s.status = 'sent'`,
  ).all()) {
    for (const entityId of [row.person_id, row.company_id]) {
      if (entityId) evidence(mailByEntity, entityId).out = true;
    }
  }

  return new Map([...workspace.index.entities.values()].map((entity) => [
    entity.id,
    deriveEntityState({
      entity,
      status: statusByEntity.get(entity.id),
      interaction: interactionByEntity.get(entity.id),
      mail: mailByEntity.get(entity.id),
    }),
  ]));
}

function stateFor(entity, stateByEntity) {
  return stateByEntity?.get(entity.id) ?? deriveEntityState({ entity });
}

export function entityMailAddresses(entity) {
  return extractMailAddresses([entity?.meta?.mail, entity?.meta?.mails]);
}

export function mailEntityIndex(index) {
  const entitiesByAddress = new Map();
  for (const entity of index.entities.values()) {
    for (const address of entityMailAddresses(entity)) {
      if (!entitiesByAddress.has(address)) entitiesByAddress.set(address, entity);
    }
  }
  return entitiesByAddress;
}

export function networkStats(index) {
  const byType = {};
  const byStatus = {};
  for (const entity of index.entities.values()) {
    const type = entity.meta.type;
    const status = entity.meta.status;
    byType[type] = (byType[type] ?? 0) + 1;
    if (status) byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    total: index.entities.size,
    byType,
    byStatus,
    edgeCount: index.edges.length,
  };
}

export function csv(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

export function entityListItem(entity, index, statsByEntity, stateByEntity) {
  return {
    id: entity.id,
    name: entity.meta.name,
    type: entity.meta.type,
    subtype: entity.meta.subtype ?? null,
    role: entity.meta.role ?? null,
    closeness: entity.meta.closeness ?? null,
    hook: entity.meta.hook ?? null,
    mail_source: entity.meta.mail_source ?? null,
    tags: Array.isArray(entity.meta.tags) ? entity.meta.tags : null,
    status: entity.meta.status ?? null,
    score: profileScore(entity.meta),
    guven: profileConfidence(entity.meta),
    katman: entity.meta.katman ?? null,
    politika_durumu: ["no_contact", "defer"].includes(entity.meta.politika_durumu)
      ? entity.meta.politika_durumu
      : null,
    politika_metni: entity.meta.politika_metni ?? null,
    city: entity.meta.city ?? null,
    mail: entity.meta.mail ?? null,
    // Adapter-mapped / manual-outreach fields. `phone` and `kimlik_guveni` are
    // DISPLAY ONLY — lib/outreach-guard.mjs keeps them out of every generator
    // and sender; they exist so a human can dial the number himself.
    org: entity.meta.org ?? null,
    location: entity.meta.location ?? entity.meta.city ?? null,
    durum: entity.meta.durum ?? null,
    lead_source: entity.meta.lead_source ?? null,
    phone: entity.meta.phone ?? null,
    // Kurum kartının SANTRALİ ayrı alan: kişi telefonuyla aynı kutuya konmaz.
    // Liste "yazılabilir numara" bandını kurarken ikisini ayırt edebilsin diye
    // taşınıyor (santral aranır, WhatsApp'tan yazılmaz).
    santral: entity.meta.santral ?? null,
    phone_source: entity.meta.phone_source ?? null,
    contact_channel: entity.meta.contact_channel ?? null,
    birincil_kanal: entity.meta.birincil_kanal ?? entity.meta.contact_channel ?? null,
    kimlik_guveni: entity.meta.kimlik_guveni ?? null,
    gun: entity.meta.gun ?? null,
    sira: Number.isInteger(entity.meta.sira) ? entity.meta.sira : null,
    // ⚠️ 0 ile YOKLUK ayrı tutuluyor: `odul_sayisi: 0` "sayıldı, ödül yok" demek;
    // alanın hiç olmaması "bakılmadı" demek. `?? 0` yazmak ikisini aynı kutuya
    // koyardı ve liste "ödülsüz" ile "bilinmiyor"u aynı gösterirdi. (Aynı aile:
    // bozuk sayaç "sorun yok" demeye devam eder.) Bugün 54 takımın 23'ünde 0 var.
    odul_sayisi: Number.isInteger(entity.meta.odul_sayisi)
      ? entity.meta.odul_sayisi
      : null,
    // Takım satırında tıklamasız görünen saha istihbaratı: kısa şasi/robot
    // durumu (Tuna'nın gözlemi) + dünya OPR sırası. null = ölçülmedi/bilinmiyor.
    robot: entity.meta.robot ?? null,
    dunya_sirasi: Number.isInteger(entity.meta.dunya_sirasi_2025)
      ? entity.meta.dunya_sirasi_2025
      : null,
    degree: index.degrees.get(entity.id) ?? 0,
    ...(statsByEntity.get(entity.id) ?? emptyMailStats()),
    ...stateFor(entity, stateByEntity),
  };
}

function increment(counter, value) {
  if (typeof value !== "string" || !value.trim()) return;
  counter[value] = (counter[value] ?? 0) + 1;
}

export function facets(index) {
  const subtypes = Object.fromEntries(
    Object.keys(TYPE_DIRECTORIES).map((type) => [type, {}]),
  );
  const statuses = {};
  const cities = {};
  const mailSources = {};

  for (const entity of index.entities.values()) {
    increment(subtypes[entity.meta.type], entity.meta.subtype);
    increment(statuses, entity.meta.status);
    increment(cities, entity.meta.city);
    increment(mailSources, entity.meta.mail_source);
  }

  const degrees = [...index.degrees.values()].sort((left, right) => left - right);
  return {
    subtypes,
    statuses,
    cities,
    mail_sources: mailSources,
    degree: {
      max: degrees.at(-1) ?? 0,
      p99: degrees.length ? degrees[Math.ceil(degrees.length * 0.99) - 1] : 0,
    },
  };
}

export function graph(index, statsByEntity, query, {
  stateByEntity,
  hiddenNodes = [],
} = {}) {
  const types = csv(query.types);
  const statuses = csv(query.statuses);
  const q = normalizeSearch(query.q);
  const hidden = new Set(hiddenNodes);
  const includeHidden = query.include_hidden === "1";
  let minScore = null;
  if (query.minScore !== undefined) {
    minScore = Number(query.minScore);
    if (!Number.isFinite(minScore)) {
      const error = new Error("minScore sayı olmalı");
      error.statusCode = 400;
      throw error;
    }
  }

  const visible = new Set();
  const nodes = [];
  let hiddenCount = 0;
  for (const entity of index.entities.values()) {
    const meta = entity.meta;
    const score = profileScore(meta);
    if (types && !types.has(meta.type)) continue;
    if (statuses && !statuses.has(meta.status ?? "")) continue;
    if (minScore !== null && (score === null || score < minScore)) continue;
    if (q && !normalizeSearch(meta.name).includes(q)) continue;
    if (hidden.has(entity.id)) {
      hiddenCount += 1;
      if (!includeHidden) continue;
    }
    visible.add(entity.id);
    nodes.push({
      id: entity.id,
      name: meta.name,
      type: meta.type,
      subtype: meta.subtype ?? null,
      status: meta.status ?? null,
      score,
      sira: Number.isInteger(meta.sira) ? meta.sira : null,
      politika_durumu: ["no_contact", "defer"].includes(meta.politika_durumu)
        ? meta.politika_durumu
        : null,
      politika_metni: meta.politika_metni ?? null,
      degree: index.degrees.get(entity.id) ?? 0,
      mail_count: statsByEntity.get(entity.id)?.mail_count ?? 0,
      tags: Array.isArray(meta.tags) ? meta.tags : null,
      ...stateFor(entity, stateByEntity),
    });
  }
  return {
    nodes,
    edges: index.edges.filter(
      (edge) => visible.has(edge.source) && visible.has(edge.target),
    ),
    hidden_count: hiddenCount,
  };
}
