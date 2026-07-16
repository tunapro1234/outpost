import type {
  Entity,
  EntityListItem,
  EntityMeta,
  EntityType,
  Facets,
  GraphData,
  GraphEdge,
  GraphFilters,
  GraphNode,
  MailItem,
  Relation,
  Stats,
  Status,
} from "./types";
import { trNormalize } from "./normalize";
import { TYPE_LABELS } from "./theme";

const MOCK = import.meta.env.VITE_MOCK === "1";

// ---- mock data (bundled) ----
import mockGraphRaw from "../../mock/graph.json";
import mockEntitiesRaw from "../../mock/entities.json";

const mockGraph = mockGraphRaw as unknown as GraphData;
const mockEntities = mockEntitiesRaw as unknown as Record<string, Entity>;

function nodeById(id: string): GraphNode | undefined {
  return mockGraph.nodes.find((n) => n.id === id);
}

// Build a plausible entity for ids that exist only in the graph (not in entities.json).
function fallbackEntity(id: string): Entity {
  const node = nodeById(id);
  const name = node?.name ?? id;
  const type = (node?.type ?? "company") as EntityType;
  const meta: EntityMeta = {
    type,
    name,
    subtype: node?.subtype ?? null,
    status: node?.status ?? null,
    score: node?.score ?? null,
  };
  const relations: Relation[] = [];
  for (const e of mockGraph.edges) {
    const src = typeof e.source === "string" ? e.source : e.source.id;
    const tgt = typeof e.target === "string" ? e.target : e.target.id;
    if (src === id) {
      const other = nodeById(tgt);
      if (other)
        relations.push({
          id: other.id,
          name: other.name,
          type: other.type,
          label: e.label ?? null,
          kind: e.kind,
          direction: "out",
        });
    } else if (tgt === id) {
      const other = nodeById(src);
      if (other)
        relations.push({
          id: other.id,
          name: other.name,
          type: other.type,
          label: e.label ?? null,
          kind: e.kind,
          direction: "in",
        });
    }
  }
  const typeLabel = TYPE_LABELS[type] ?? type;
  return {
    id,
    meta,
    body: `${name} — ${typeLabel}. Bu düğüm için ayrıntılı not henüz yok.`,
    relations,
    unresolved: [],
  };
}

function edgeEndpoints(e: GraphEdge): [string, string] {
  const src = typeof e.source === "string" ? e.source : e.source.id;
  const tgt = typeof e.target === "string" ? e.target : e.target.id;
  return [src, tgt];
}

// ---- mock filtering ----
function filterGraph(filters: GraphFilters): GraphData {
  const q = trNormalize(filters.q);
  const nodes = mockGraph.nodes.filter((n) => {
    if (filters.types.length && !filters.types.includes(n.type)) return false;
    if (filters.statuses.length) {
      if (!n.status || !filters.statuses.includes(n.status)) return false;
    }
    if (filters.minScore != null) {
      if (n.score == null || n.score < filters.minScore) return false;
    }
    if (q && !trNormalize(n.name).includes(q)) return false;
    return true;
  });
  const visible = new Set(nodes.map((n) => n.id));
  const edges = mockGraph.edges.filter((e) => {
    const [s, t] = edgeEndpoints(e);
    return visible.has(s) && visible.has(t);
  });
  return { nodes, edges };
}

function mockEntityList(params: {
  type?: EntityType | null;
  status?: Status | null;
  q?: string;
  sort?: "score" | "name" | "degree";
  order?: "asc" | "desc";
}): EntityListItem[] {
  const q = trNormalize(params.q ?? "");
  let items: EntityListItem[] = mockGraph.nodes
    .filter((n) => {
      if (params.type && n.type !== params.type) return false;
      if (params.status && n.status !== params.status) return false;
      if (q && !trNormalize(n.name).includes(q)) return false;
      return true;
    })
    .map((n) => {
      const full = mockEntities[n.id];
      return {
        id: n.id,
        name: n.name,
        type: n.type,
        subtype: n.subtype ?? null,
        status: n.status ?? null,
        score: n.score ?? null,
        city: (full?.meta.city as string | undefined) ?? null,
        mail: (full?.meta.mail as string | undefined) ?? null,
        degree: n.degree,
      };
    });
  const sort = params.sort ?? "score";
  const order = params.order ?? "desc";
  items = items.sort((a, b) => {
    let cmp = 0;
    if (sort === "name") cmp = a.name.localeCompare(b.name, "tr");
    else if (sort === "degree") cmp = a.degree - b.degree;
    else cmp = (a.score ?? -Infinity) - (b.score ?? -Infinity);
    return order === "asc" ? cmp : -cmp;
  });
  return items;
}

function mockStats(): Stats {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const n of mockGraph.nodes) {
    byType[n.type] = (byType[n.type] ?? 0) + 1;
    if (n.status) byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
  }
  return {
    total: mockGraph.nodes.length,
    byType,
    byStatus,
    edgeCount: mockGraph.edges.length,
  };
}

// ---- real-mode helpers ----
function buildGraphQuery(f: GraphFilters): string {
  const p = new URLSearchParams();
  if (f.types.length) p.set("types", f.types.join(","));
  if (f.statuses.length) p.set("statuses", f.statuses.join(","));
  if (f.minScore != null) p.set("minScore", String(f.minScore));
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

// ---- public API ----
export const api = {
  mock: MOCK,

  async graph(filters: GraphFilters): Promise<GraphData> {
    if (MOCK) return filterGraph(filters);
    return json<GraphData>(`/api/graph${buildGraphQuery(filters)}`);
  },

  // Full unfiltered graph — v2 loads this once and filters client-side.
  async fullGraph(): Promise<GraphData> {
    if (MOCK) return filterGraph({ types: [], statuses: [], minScore: null, q: "" });
    return json<GraphData>(`/api/graph`);
  },

  // Server-provided facets. Returns null on 404 so the caller derives them.
  async facets(): Promise<Facets | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`/api/facets`);
      if (!res.ok) return null;
      return (await res.json()) as Facets;
    } catch {
      return null;
    }
  },

  // Mail log. Returns null on 404 (endpoint not deployed yet) vs [] (no mails).
  async mails(): Promise<MailItem[] | null> {
    if (MOCK) return [];
    try {
      const res = await fetch(`/api/mails`);
      if (!res.ok) return null;
      return (await res.json()) as MailItem[];
    } catch {
      return null;
    }
  },

  async entities(params: {
    type?: EntityType | null;
    status?: Status | null;
    q?: string;
    sort?: "score" | "name" | "degree";
    order?: "asc" | "desc";
  }): Promise<EntityListItem[]> {
    if (MOCK) return mockEntityList(params);
    const p = new URLSearchParams();
    if (params.type) p.set("type", params.type);
    if (params.status) p.set("status", params.status);
    if (params.q) p.set("q", params.q);
    if (params.sort) p.set("sort", params.sort);
    if (params.order) p.set("order", params.order);
    const s = p.toString();
    return json<EntityListItem[]>(`/api/entities${s ? `?${s}` : ""}`);
  },

  async entity(id: string): Promise<Entity> {
    if (MOCK) return mockEntities[id] ?? fallbackEntity(id);
    return json<Entity>(`/api/entities/${encodeURIComponent(id)}`);
  },

  async patchEntity(
    id: string,
    patch: { meta?: Record<string, unknown>; body?: string }
  ): Promise<Entity> {
    if (MOCK) {
      const cur = mockEntities[id] ?? fallbackEntity(id);
      const next: Entity = {
        ...cur,
        meta: { ...cur.meta, ...(patch.meta ?? {}) },
        body: patch.body ?? cur.body,
      };
      // reflect status/score back into the graph node for live feedback
      const node = nodeById(id);
      if (node && patch.meta) {
        if ("status" in patch.meta)
          node.status = patch.meta.status as Status | null;
        if ("score" in patch.meta)
          node.score = patch.meta.score as number | null;
      }
      mockEntities[id] = next;
      return next;
    }
    return json<Entity>(`/api/entities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  async createEntity(payload: {
    type: EntityType;
    name: string;
    meta?: Record<string, unknown>;
    body?: string;
  }): Promise<Entity> {
    if (MOCK) {
      const id = trNormalize(payload.name).replace(/\s+/g, "-") || "yeni";
      const ent: Entity = {
        id,
        meta: { type: payload.type, name: payload.name, ...(payload.meta ?? {}) },
        body: payload.body ?? "",
        relations: [],
        unresolved: [],
      };
      mockEntities[id] = ent;
      if (!nodeById(id)) {
        mockGraph.nodes.push({
          id,
          name: payload.name,
          type: payload.type,
          subtype: (payload.meta?.subtype as string) ?? null,
          status: (payload.meta?.status as Status) ?? null,
          score: (payload.meta?.score as number) ?? null,
          degree: 0,
        });
      }
      return ent;
    }
    return json<Entity>(`/api/entities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  async stats(): Promise<Stats> {
    if (MOCK) return mockStats();
    return json<Stats>(`/api/stats`);
  },
};
