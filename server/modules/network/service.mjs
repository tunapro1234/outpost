import { TYPE_DIRECTORIES } from "../../lib/vault.mjs";
import { normalizeSearch } from "../../lib/slug.mjs";
import { extractMailAddresses } from "../mail/parser.mjs";
import { emptyMailStats } from "../reach/mails.mjs";

export const VALID_TYPES = new Set(Object.keys(TYPE_DIRECTORIES));

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

export function entityListItem(entity, index, statsByEntity) {
  return {
    id: entity.id,
    name: entity.meta.name,
    type: entity.meta.type,
    subtype: entity.meta.subtype ?? null,
    role: entity.meta.role ?? null,
    closeness: entity.meta.closeness ?? null,
    hook: entity.meta.hook ?? null,
    mail_source: entity.meta.mail_source ?? null,
    status: entity.meta.status ?? null,
    score: typeof entity.meta.score === "number" ? entity.meta.score : null,
    city: entity.meta.city ?? null,
    mail: entity.meta.mail ?? null,
    degree: index.degrees.get(entity.id) ?? 0,
    ...(statsByEntity.get(entity.id) ?? emptyMailStats()),
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

export function graph(index, statsByEntity, query) {
  const types = csv(query.types);
  const statuses = csv(query.statuses);
  const q = normalizeSearch(query.q);
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
  for (const entity of index.entities.values()) {
    const meta = entity.meta;
    const score = typeof meta.score === "number" ? meta.score : null;
    if (types && !types.has(meta.type)) continue;
    if (statuses && !statuses.has(meta.status ?? "")) continue;
    if (minScore !== null && (score === null || score < minScore)) continue;
    if (q && !normalizeSearch(meta.name).includes(q)) continue;
    visible.add(entity.id);
    nodes.push({
      id: entity.id,
      name: meta.name,
      type: meta.type,
      subtype: meta.subtype ?? null,
      status: meta.status ?? null,
      score,
      degree: index.degrees.get(entity.id) ?? 0,
      mail_count: statsByEntity.get(entity.id)?.mail_count ?? 0,
    });
  }
  return {
    nodes,
    edges: index.edges.filter(
      (edge) => visible.has(edge.source) && visible.has(edge.target),
    ),
  };
}
