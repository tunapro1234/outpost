import type {
  EntityType,
  Facets,
  GraphData,
  GraphEdge,
  GraphNode,
  Status,
} from "./types";
import { trNormalize } from "./normalize";

export type MailMode = "any" | "has" | "none";
export type QField = "name" | "hook" | "city";

export interface FilterState {
  q: string;
  qFields: QField[];
  types: EntityType[];
  subtypes: string[]; // encoded "type::subtype"
  statuses: Status[];
  noStatus: boolean;
  scoreMin: number | null;
  scoreMax: number | null;
  includeUnscored: boolean;
  degreeMin: number | null;
  degreeMax: number | null;
  hideIsolated: boolean;
  cities: string[]; // normalized city keys
  mail: MailMode;
  mailSources: string[];
  closenessMin: number;
  closenessMax: number;
  showRelation: boolean;
  showMention: boolean;
  egoId: string | null;
  egoDepth: number;
  hubHide: boolean;
  hubThreshold: number | null;
}

export const DEFAULT_FILTERS: FilterState = {
  q: "",
  qFields: ["name", "hook", "city"],
  types: [],
  subtypes: [],
  statuses: [],
  noStatus: false,
  scoreMin: null,
  scoreMax: null,
  includeUnscored: true,
  degreeMin: null,
  degreeMax: null,
  hideIsolated: false,
  cities: [],
  mail: "any",
  mailSources: [],
  closenessMin: 0,
  closenessMax: 5,
  showRelation: true,
  showMention: false,
  egoId: null,
  egoDepth: 2,
  hubHide: false,
  hubThreshold: null,
};

export function subtypeKey(type: EntityType, subtype: string): string {
  return `${type}::${subtype}`;
}

export function cityKey(city: string | null | undefined): string {
  if (!city) return "";
  return trNormalize(city).replace(/\s+/g, " ").trim();
}

// ---- persistence --------------------------------------------------------
const LS_FILTERS = "outpost.filters.v2";

export function loadFilters(): FilterState {
  // URL takes precedence (shareable link)
  const url = decodeFiltersFromUrl();
  if (url) return url;
  try {
    const raw = localStorage.getItem(LS_FILTERS);
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_FILTERS };
}

function diffFromDefault(f: FilterState): Partial<FilterState> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_FILTERS) as (keyof FilterState)[]) {
    const a = JSON.stringify(f[k]);
    const b = JSON.stringify(DEFAULT_FILTERS[k]);
    if (a !== b) out[k] = f[k];
  }
  return out as Partial<FilterState>;
}

export function persistFilters(f: FilterState): void {
  const diff = diffFromDefault(f);
  try {
    localStorage.setItem(LS_FILTERS, JSON.stringify(diff));
  } catch {
    /* ignore */
  }
  const enc = encodeURIComponent(JSON.stringify(diff));
  const url = new URL(window.location.href);
  if (Object.keys(diff).length) url.searchParams.set("f", enc);
  else url.searchParams.delete("f");
  window.history.replaceState(null, "", url.toString());
}

export function decodeFiltersFromUrl(): FilterState | null {
  try {
    const p = new URLSearchParams(window.location.search);
    const f = p.get("f");
    if (!f) return null;
    const parsed = JSON.parse(decodeURIComponent(f));
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return null;
  }
}

export function isDirty(f: FilterState): boolean {
  return Object.keys(diffFromDefault(f)).length > 0;
}

// ---- adjacency ----------------------------------------------------------
export interface Adjacency {
  // undirected neighbor sets over relation+mention
  all: Map<string, Set<string>>;
  // relation-only (used for ego so a mega mention hub doesn't leak)
  relation: Map<string, Set<string>>;
}

function endId(n: string | GraphNode): string {
  return typeof n === "string" ? n : n.id;
}

export function buildAdjacency(edges: GraphEdge[], nodes: GraphNode[]): Adjacency {
  const all = new Map<string, Set<string>>();
  const relation = new Map<string, Set<string>>();
  for (const n of nodes) {
    all.set(n.id, new Set());
    relation.set(n.id, new Set());
  }
  for (const e of edges) {
    const s = endId(e.source);
    const t = endId(e.target);
    all.get(s)?.add(t);
    all.get(t)?.add(s);
    if (e.kind === "relation") {
      relation.get(s)?.add(t);
      relation.get(t)?.add(s);
    }
  }
  return { all, relation };
}

export function egoSet(
  adj: Adjacency,
  rootId: string,
  depth: number
): Set<string> {
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.all.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

// ---- facets -------------------------------------------------------------
export function deriveFacets(nodes: GraphNode[]): Facets {
  const subtypes: Facets["subtypes"] = {};
  const statuses: Record<string, number> = {};
  const cities: Record<string, number> = {};
  const cityDisplay: Record<string, string> = {};
  const mail_sources: Record<string, number> = {};
  const degrees: number[] = [];
  for (const n of nodes) {
    if (n.subtype) {
      const bag = (subtypes[n.type] ??= {});
      bag[n.subtype] = (bag[n.subtype] ?? 0) + 1;
    }
    if (n.status) statuses[n.status] = (statuses[n.status] ?? 0) + 1;
    if (n.city) {
      const key = cityKey(n.city);
      if (key) {
        cities[key] = (cities[key] ?? 0) + 1;
        if (!cityDisplay[key]) cityDisplay[key] = n.city.trim();
      }
    }
    if (n.mailSource) mail_sources[n.mailSource] = (mail_sources[n.mailSource] ?? 0) + 1;
    degrees.push(n.degree);
  }
  degrees.sort((a, b) => a - b);
  const p99 = degrees.length
    ? degrees[Math.min(degrees.length - 1, Math.floor(degrees.length * 0.99))]
    : 0;
  const max = degrees.length ? degrees[degrees.length - 1] : 0;
  // stash display names on the cities record under a side channel
  (cities as Record<string, number> & { __display?: Record<string, string> }).__display =
    cityDisplay as unknown as number & Record<string, string>;
  return { subtypes, statuses, cities, mail_sources, degree: { max, p99 } };
}

export function cityDisplayName(facets: Facets, key: string): string {
  const disp = (facets.cities as Record<string, unknown>).__display as
    | Record<string, string>
    | undefined;
  return disp?.[key] ?? key;
}

// ---- filtering ----------------------------------------------------------
function hasMail(n: GraphNode): boolean {
  const m = (n.mail ?? "").trim();
  return m !== "" && m !== "-" && m !== "yok";
}

export interface FilterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  typeCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  hubSet: Set<string>;
  egoActive: boolean;
}

function nodePasses(n: GraphNode, f: FilterState, ego: Set<string> | null): boolean {
  if (ego && !ego.has(n.id)) return false;

  if (f.types.length && !f.types.includes(n.type)) return false;

  if (f.subtypes.length) {
    const key = n.subtype ? subtypeKey(n.type, n.subtype) : null;
    if (!key || !f.subtypes.includes(key)) return false;
  }

  if (f.statuses.length || f.noStatus) {
    const statusOk =
      (n.status && f.statuses.includes(n.status)) ||
      (f.noStatus && !n.status);
    if (!statusOk) return false;
  }

  // score
  if (n.score == null) {
    if (!f.includeUnscored) return false;
  } else {
    if (f.scoreMin != null && n.score < f.scoreMin) return false;
    if (f.scoreMax != null && n.score > f.scoreMax) return false;
  }

  // degree
  if (f.degreeMin != null && n.degree < f.degreeMin) return false;
  if (f.degreeMax != null && n.degree > f.degreeMax) return false;

  // city
  if (f.cities.length) {
    const ck = cityKey(n.city);
    if (!ck || !f.cities.includes(ck)) return false;
  }

  // mail presence
  if (f.mail === "has" && !hasMail(n)) return false;
  if (f.mail === "none" && hasMail(n)) return false;
  if (f.mailSources.length) {
    if (!n.mailSource || !f.mailSources.includes(n.mailSource)) return false;
  }

  // closeness (person). Unknown closeness passes unless a real subrange is set.
  if (n.type === "person" && (f.closenessMin > 0 || f.closenessMax < 5)) {
    const c = n.closeness;
    if (c != null && (c < f.closenessMin || c > f.closenessMax)) return false;
  }

  // hub hide
  if (f.hubHide && f.hubThreshold != null && n.degree > f.hubThreshold) {
    return false;
  }

  // text search
  const q = trNormalize(f.q);
  if (q) {
    const parts: string[] = [];
    if (f.qFields.includes("name")) parts.push(n.name);
    if (f.qFields.includes("hook") && n.hook) parts.push(n.hook);
    if (f.qFields.includes("city") && n.city) parts.push(n.city);
    const hay = trNormalize(parts.join(" "));
    if (!hay.includes(q)) return false;
  }

  return true;
}

export function applyFilters(
  data: GraphData,
  f: FilterState,
  adj: Adjacency
): FilterResult {
  const ego =
    f.egoId && adj.all.has(f.egoId) ? egoSet(adj, f.egoId, f.egoDepth) : null;

  const visible: GraphNode[] = [];
  const visibleIds = new Set<string>();
  for (const n of data.nodes) {
    if (nodePasses(n, f, ego)) {
      visible.push(n);
      visibleIds.add(n.id);
    }
  }

  let edges = data.edges.filter((e) => {
    if (e.kind === "relation" && !f.showRelation) return false;
    if (e.kind === "mention" && !f.showMention) return false;
    return visibleIds.has(endId(e.source)) && visibleIds.has(endId(e.target));
  });

  let nodes = visible;
  if (f.hideIsolated) {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(endId(e.source));
      connected.add(endId(e.target));
    }
    nodes = visible.filter((n) => connected.has(n.id));
    const keep = new Set(nodes.map((n) => n.id));
    edges = edges.filter(
      (e) => keep.has(endId(e.source)) && keep.has(endId(e.target))
    );
  }

  const typeCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const hubSet = new Set<string>();
  for (const n of nodes) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
    if (n.status) statusCounts[n.status] = (statusCounts[n.status] ?? 0) + 1;
    if (f.hubThreshold != null && n.degree > f.hubThreshold) hubSet.add(n.id);
  }

  return {
    nodes,
    edges,
    typeCounts,
    statusCounts,
    hubSet,
    egoActive: ego != null,
  };
}

// ---- presets ------------------------------------------------------------
export interface Preset {
  name: string;
  filters: Partial<FilterState>;
  builtin?: boolean;
}

const LS_PRESETS = "outpost.presets.v2";

export const BUILTIN_PRESETS: Preset[] = [
  {
    name: "Targets",
    builtin: true,
    filters: {
      types: ["company", "institution", "school"],
      scoreMin: 15,
      includeUnscored: false,
    },
  },
  {
    name: "Hot",
    builtin: true,
    filters: { statuses: ["gonderildi", "cevap", "randevu"] },
  },
  {
    name: "Network backbone",
    builtin: true,
    filters: { degreeMin: 5, hideIsolated: true },
  },
];

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    const saved: Preset[] = raw ? JSON.parse(raw) : [];
    return [...BUILTIN_PRESETS, ...saved];
  } catch {
    return [...BUILTIN_PRESETS];
  }
}

export function saveUserPresets(all: Preset[]): void {
  const user = all.filter((p) => !p.builtin);
  try {
    localStorage.setItem(LS_PRESETS, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

export function applyPreset(base: FilterState, p: Preset): FilterState {
  return { ...DEFAULT_FILTERS, q: base.q, qFields: base.qFields, ...p.filters };
}
