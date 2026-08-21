import type {
  Agent,
  AgentRun,
  MailAgentConfig,
  MailAgentModel,
  Entity,
  EntityStatusResult,
  EntityListItem,
  EntityMeta,
  EntityType,
  Exclusion,
  Facets,
  FleetResponse,
  GatherOverview,
  GraphData,
  GraphNode,
  Interaction,
  InteractionChannel,
  InteractionDirection,
  MailDraft,
  MailImportItem,
  MailImportResult,
  MailItem,
  MailSettings,
  MailQueueSummary,
  MailTrackingSummary,
  MailRecord,
  MailRecordDetail,
  MailAnalytics,
  MailRejectPayload,
  MailRejectResult,
  PersonalAgent,
  ReachStats,
  Metrics,
  Profile,
  Relation,
  StageItem,
  Status,
  UserStat,
  NetworkInfo,
  TemasDurumu,
  TemasDurumuResult,
  WorkspaceInfo,
} from "./types";
import { trNormalize } from "./normalize";
import { TYPE_LABELS } from "./theme";

const MOCK = import.meta.env.VITE_MOCK === "1";

let activeWorkspace: string | null = null;

export function setWorkspace(id: string): void {
  activeWorkspace = id;
}

export function getWorkspace(): string {
  if (!activeWorkspace) throw new Error("Workspace has not been selected");
  return activeWorkspace;
}

export function workspaceBase(): string {
  return `/api/ws/${encodeURIComponent(getWorkspace())}`;
}

// ---- network selection -------------------------------------------------
// A workspace is a line of business; it holds one or more networks (separate
// graphs, never merged). Graph/entity endpoints take `?network=<id>`; leaving
// it unset asks the server for the workspace's default network.
let activeNetwork: string | null = null;

export function setNetwork(id: string | null): void {
  activeNetwork = id;
}

export function getNetwork(): string | null {
  return activeNetwork;
}

function netUrl(url: string, params?: URLSearchParams): string {
  const p = params ?? new URLSearchParams();
  if (activeNetwork) p.set("network", activeNetwork);
  const q = p.toString();
  return q ? `${url}?${q}` : url;
}

// ---- mock data (bundled) ----
import mockGraphRaw from "../../mock/graph.json";
import mockEntitiesRaw from "../../mock/entities.json";

const mockGraph = mockGraphRaw as unknown as GraphData;
const mockEntities = mockEntitiesRaw as unknown as Record<string, Entity>;
const mockTemas = new Map<string, TemasDurumuResult>();

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
    body: `${name}, ${typeLabel}. Bu düğüm için ayrıntılı not henüz yok.`,
    relations,
    unresolved: [],
  };
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
        mail_count: 0,
        last_mail_date: null,
        last_mail_direction: null,
        last_mail_from: null,
        role: (full?.meta.role as string | undefined) ?? null,
        closeness: (full?.meta.closeness as number | undefined) ?? null,
        hook: (full?.meta.hook as string | undefined) ?? null,
        mail_source: (full?.meta.mail_source as string | undefined) ?? null,
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

// Derive a plausible metrics payload from the bundled mock graph so the
// Overview page renders in mock/dev mode without a live server.
function mockMetrics(): Metrics {
  const byType: Record<string, number> = {};
  for (const n of mockGraph.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const today = new Date();
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    return { date: d.toISOString().slice(0, 10), count: 0 };
  });
  return {
    totals: {
      entities: mockGraph.nodes.length,
      byType,
      withMail: 0,
      withoutMail: mockGraph.nodes.length,
    },
    outreach: {
      mailsSent: 0,
      uniqueRecipients: 0,
      reached: 0,
      stateHistogram: {
        0: mockGraph.nodes.length,
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      },
      firstMailAt: null,
      lastMailAt: null,
      activeDays: 0,
      avgPerActiveDay: 0,
      daily,
      byStatus: {},
    },
    gather: { staged: 0, acceptedTotal: 0, agents: 0, running: 0 },
    reach: { candidates: 0 },
    recentActivity: [],
  };
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

  // Full unfiltered graph — v2 loads this once and filters client-side.
  async fullGraph(): Promise<GraphData> {
    if (MOCK) return { nodes: mockGraph.nodes, edges: mockGraph.edges };
    return json<GraphData>(netUrl(`${workspaceBase()}/graph`));
  },

  // Server-provided facets. Returns null on 404 so the caller derives them.
  async facets(): Promise<Facets | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(netUrl(`${workspaceBase()}/facets`));
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
      const res = await fetch(`${workspaceBase()}/mails`);
      if (!res.ok) return null;
      return (await res.json()) as MailItem[];
    } catch {
      return null;
    }
  },

  async reachStats(): Promise<ReachStats | null> {
    if (MOCK) {
      return { sent: 0, replied: 0, replyRate: 0, pendingFollowUp: 0 };
    }
    try {
      const res = await fetch(`${workspaceBase()}/reach/stats`);
      if (!res.ok) return null;
      return (await res.json()) as ReachStats;
    } catch {
      return null;
    }
  },

  // Mail queue summary — scanned-and-ready ("queue") vs still-to-scan
  // ("awaitingScan") people. Returns null on 404 / error so the pipeline band
  // can hide gracefully while the endpoint is still shipping.
  async mailqueue(): Promise<MailQueueSummary | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/mailqueue`);
      if (!res.ok) return null;
      return (await res.json()) as MailQueueSummary;
    } catch {
      return null;
    }
  },

  // Mail tracking — one row per approved/tokenised mail with open/click state.
  // Returns null on 404 (endpoint not deployed yet) so the Sent tab can fall
  // back to the plain mail log.
  async mailtracking(): Promise<MailTrackingSummary | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/mailtracking`);
      if (!res.ok) return null;
      return (await res.json()) as MailTrackingSummary;
    } catch {
      return null;
    }
  },

  // Canonical mail DB — one record per approved mail with content, tracking and
  // full creation provenance. Returns null on 404 so the Sent tab degrades.
  async maildb(): Promise<MailRecord[] | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/maildb`);
      if (!res.ok) return null;
      const body = (await res.json()) as { mails?: MailRecord[] };
      return body.mails ?? [];
    } catch {
      return null;
    }
  },

  async maildbDetail(id: string): Promise<MailRecordDetail | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/maildb/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      return (await res.json()) as MailRecordDetail;
    } catch {
      return null;
    }
  },

  // Reply-rate breakdowns for optimizing outreach. Null on 404.
  async mailanalytics(): Promise<MailAnalytics | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/mailanalytics`);
      if (!res.ok) return null;
      return (await res.json()) as MailAnalytics;
    } catch {
      return null;
    }
  },

  // Mail drafts awaiting approval. Returns null on 404 (endpoint not deployed
  // yet) vs [] (no drafts) so the approval surfaces can hide gracefully.
  async maildrafts(): Promise<MailDraft[] | null> {
    if (MOCK) return [];
    try {
      const res = await fetch(`${workspaceBase()}/maildrafts`);
      if (!res.ok) return null;
      const body = (await res.json()) as { drafts?: MailDraft[] } | MailDraft[];
      return Array.isArray(body) ? body : body.drafts ?? [];
    } catch {
      return null;
    }
  },

  // Approve a draft: chosen variant + optionally edited subject/body. Resolves
  // on success; throws Error(message) on failure so the card can surface it.
  async approveMailDraft(
    id: string,
    payload: { variant: number; subject?: string; body?: string }
  ): Promise<{ ok: boolean }> {
    return json<{ ok: boolean }>(
      `${workspaceBase()}/maildrafts/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  // Reject a draft with an optional structured reason. The server may cascade
  // (e.g. exclude-company also rejects the company's other pending drafts) and
  // reports every removed id plus any side effect. Degrades gracefully: on an
  // old server that returns { ok: true } with no cascade info we fall back to
  // rejecting just this draft, so plain reject keeps working.
  async rejectMailDraft(
    id: string,
    payload?: MailRejectPayload
  ): Promise<MailRejectResult> {
    const body: Record<string, unknown> = {};
    if (payload?.kind) body.kind = payload.kind;
    if (payload?.text) body.text = payload.text;
    const res = await fetch(
      `${workspaceBase()}/maildrafts/${encodeURIComponent(id)}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
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
    let data: {
      rejected?: unknown;
      company_excluded?: { id: string; name: string };
      person_closed?: { id: string; name: string };
    } = {};
    try {
      data = await res.json();
    } catch {
      /* 204 / empty body — treat as a bare success */
    }
    const rejected =
      Array.isArray(data?.rejected) && data.rejected.length > 0
        ? (data.rejected as string[])
        : [id];
    return {
      rejected,
      company_excluded: data?.company_excluded,
      person_closed: data?.person_closed,
    };
  },

  // ---- mail settings (server GET/PUT /api/ws/:ws/mail-settings) ----------
  // Workspace outreach controls. Returns null on 404 / error so the Settings
  // tab renders a graceful "coming online" state while the endpoint ships.
  async mailSettings(): Promise<MailSettings | null> {
    if (MOCK) {
      return {
        approval_threshold: 60,
        dispatch_mode: "dry_run",
        cold_after_days: 14,
        followup_gap_days: 4,
        daily_max_sends: 0,
        schedule: {
          timezone: "Europe/Istanbul",
          windows: [{ startMin: 540, endMin: 1080 }],
          weekdays: [1, 2, 3, 4, 5],
          jitterMin: 5,
          rollingPerHour: 6,
          minGapMin: 8,
          dailyMax: 0,
        },
      };
    }
    try {
      const res = await fetch(`${workspaceBase()}/mail-settings`);
      if (!res.ok) return null;
      return (await res.json()) as MailSettings;
    } catch {
      return null;
    }
  },

  // Persist a partial patch (only changed fields). Owner-only on the server.
  // Returns the full normalized settings; throws Error(message) on failure.
  async updateMailSettings(
    patch: Partial<MailSettings>
  ): Promise<MailSettings> {
    return json<MailSettings>(`${workspaceBase()}/mail-settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  // Import a batch of past mails (owner-only). Returns match/skip counts;
  // throws Error(message) on failure so the Settings tab can surface it.
  async importMails(payload: {
    mails: MailImportItem[];
    author?: string;
  }): Promise<MailImportResult> {
    return json<MailImportResult>(`${workspaceBase()}/mail/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  // ---- mail agent model config (SPEC-MAILCAL §11) ------------------------
  // Returns null on 404 / error so callers fall back to the default model.
  async mailAgentConfig(): Promise<MailAgentConfig | null> {
    if (MOCK) return { model: "claude-opus-4-8" };
    try {
      const res = await fetch(`${workspaceBase()}/mailagent/config`);
      if (!res.ok) return null;
      return (await res.json()) as MailAgentConfig;
    } catch {
      return null;
    }
  },

  // Persist the selected model. Switching a Claude model respawns the tmux
  // mail agent; gpt-5.6-sol switches to per-run codex exec (no chat).
  async saveMailAgentConfig(model: MailAgentModel): Promise<MailAgentConfig> {
    return json<MailAgentConfig>(`${workspaceBase()}/mailagent/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
  },

  // ---- workspace user stats (SPEC-MAILCAL §3) ----------------------------
  // Returns null on 404 / error so the Workspace page degrades gracefully.
  async usersStats(): Promise<UserStat[] | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/users/stats`);
      if (!res.ok) return null;
      return (await res.json()) as UserStat[];
    } catch {
      return null;
    }
  },

  // ---- personal agents (SPEC-MAILCAL §5) ---------------------------------
  // The caller's own agents (assistant + mail writer). Returns null on 404 /
  // error so the Personal-agents section on the Agents page hides gracefully.
  async personalAgents(): Promise<PersonalAgent[] | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/personal-agents`);
      if (!res.ok) return null;
      return (await res.json()) as PersonalAgent[];
    } catch {
      return null;
    }
  },

  // Live bp/tmux fleet. Operational inspection is best-effort: callers get an
  // unavailable empty result if either the endpoint or the local tools fail.
  async fleet(): Promise<FleetResponse | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/fleet`);
      if (!res.ok) return null;
      return (await res.json()) as FleetResponse;
    } catch {
      return null;
    }
  },

  // Overview metrics. Returns null on 404 / error (endpoint may still be
  // shipping) so the dashboard degrades to a graceful empty state.
  async metrics(): Promise<Metrics | null> {
    if (MOCK) return mockMetrics();
    try {
      const res = await fetch(`${workspaceBase()}/metrics`);
      if (!res.ok) return null;
      return (await res.json()) as Metrics;
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
    return json<EntityListItem[]>(netUrl(`${workspaceBase()}/entities`, p));
  },

  // The Today panel is intentionally pinned to the `hedef` network and must
  // not follow the Network screen's active selection.
  async todayEntities(): Promise<EntityListItem[]> {
    if (MOCK) return mockEntityList({ sort: "name", order: "asc" });
    const p = new URLSearchParams({ network: "hedef", sort: "name", order: "asc" });
    const list = await json<EntityListItem[]>(`${workspaceBase()}/entities?${p.toString()}`);
    // Panel kişi bazlıdır: kurum/okul kartları temas akışına girmez.
    return list.filter((item) => item.type === "person");
  },

  async temas(id: string): Promise<TemasDurumuResult> {
    if (MOCK) {
      return mockTemas.get(id) ?? {
        entity_id: id,
        durum: "yazilmadi",
        guncelleme_ts: null,
        kaynak: null,
      };
    }
    return json<TemasDurumuResult>(
      `${workspaceBase()}/temas/${encodeURIComponent(id)}`
    );
  },

  // network verilmezse sunucu eski davranışa (hedef ağı) düşer — Today paneli
  // oraya sabitli, FTC hiyerarşisi ise kendi ağını açıkça geçirir.
  async patchTemas(
    id: string,
    durum: TemasDurumu,
    network?: string
  ): Promise<TemasDurumuResult> {
    if (MOCK) {
      const result: TemasDurumuResult = {
        entity_id: id,
        durum,
        guncelleme_ts: new Date().toISOString(),
        kaynak: "ui:tuna",
      };
      mockTemas.set(id, result);
      return result;
    }
    const p = new URLSearchParams();
    if (network) p.set("network", network);
    const q = p.toString();
    return json<TemasDurumuResult>(
      `${workspaceBase()}/temas/${encodeURIComponent(id)}${q ? `?${q}` : ""}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ durum }),
      }
    );
  },

  // Bir ağın TÜM temas durumları. Hiyerarşi görünümü açılışta bunu bir kez
  // çeker; kayıt başına GET atmaz. Durumu "yazilmadi" olanlar dönmez.
  async temasListesi(network: string): Promise<TemasDurumuResult[]> {
    if (MOCK) {
      return [...mockTemas.values()].filter((r) => r.durum !== "yazilmadi");
    }
    const p = new URLSearchParams({ network });
    const body = await json<{ kayitlar: TemasDurumuResult[] }>(
      `${workspaceBase()}/temas?${p.toString()}`
    );
    return body.kayitlar ?? [];
  },

  async entity(id: string): Promise<Entity> {
    if (MOCK) return mockEntities[id] ?? fallbackEntity(id);
    return json<Entity>(netUrl(`${workspaceBase()}/entities/${encodeURIComponent(id)}`));
  },

  async interactions(id: string): Promise<Interaction[]> {
    if (MOCK) return [];
    return json<Interaction[]>(
      netUrl(`${workspaceBase()}/entity/${encodeURIComponent(id)}/interactions`)
    );
  },

  async createInteraction(
    id: string,
    payload: {
      channel: InteractionChannel;
      direction?: InteractionDirection;
      at?: string;
      note?: string;
    }
  ): Promise<Interaction> {
    if (MOCK) {
      const now = new Date().toISOString();
      return {
        id: Date.now(),
        workspace: "mock",
        network: "default",
        entity_id: id,
        channel: payload.channel,
        direction: payload.direction ?? "out",
        at: payload.at ?? now,
        note: payload.note ?? null,
        source: "mock",
        created_at: now,
      };
    }
    return json<Interaction>(
      netUrl(`${workspaceBase()}/entity/${encodeURIComponent(id)}/interactions`),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  },

  async deleteInteraction(id: string, interactionId: number): Promise<void> {
    if (MOCK) return;
    await json<{ ok: boolean }>(
      netUrl(
        `${workspaceBase()}/entity/${encodeURIComponent(id)}/interactions/${interactionId}`
      ),
      { method: "DELETE" }
    );
  },

  async updateEntityStatus(
    id: string,
    outreachState: number
  ): Promise<EntityStatusResult> {
    if (MOCK) {
      return {
        entity_id: id,
        state: outreachState as EntityStatusResult["state"],
        state_source: "manual",
        research_status: "none",
      };
    }
    return json<EntityStatusResult>(
      netUrl(`${workspaceBase()}/entity/${encodeURIComponent(id)}/status`),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outreach_state: outreachState }),
      }
    );
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
    return json<Entity>(netUrl(`${workspaceBase()}/entities/${encodeURIComponent(id)}`), {
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
    return json<Entity>(netUrl(`${workspaceBase()}/entities`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  // ---- outreach exclusions ----------------------------------------------
  // Companies removed from outreach. Returns null on 404 / error so the UI can
  // hide the section entirely while the endpoint is still shipping.
  async exclusions(): Promise<Exclusion[] | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/exclusions`);
      if (!res.ok) return null;
      return (await res.json()) as Exclusion[];
    } catch {
      return null;
    }
  },

  // Override an exclusion (re-include the company in outreach). Owner-only on
  // the server: a 403 rejects with FORBIDDEN so the caller can disable the
  // control. Resolves on success; throws Error(message) otherwise.
  async removeExclusion(
    companyId: string,
    reason?: string
  ): Promise<{ ok: boolean }> {
    const trimmed = reason?.trim();
    const res = await fetch(
      `${workspaceBase()}/exclusions/${encodeURIComponent(companyId)}`,
      {
        method: "DELETE",
        ...(trimmed
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reason: trimmed }),
            }
          : {}),
      }
    );
    if (res.status === 403) throw new Error("FORBIDDEN");
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
    try {
      return (await res.json()) as { ok: boolean };
    } catch {
      return { ok: true };
    }
  },

  // ---- gather: agents / runs / stage ------------------------------------
  async agents(): Promise<Agent[]> {
    if (MOCK) return [];
    return json<Agent[]>(`${workspaceBase()}/agents`);
  },

  // Update an agent's schedule / enabled / params (throughput control).
  // Throws Error(message) on failure — message is "HTTP 404" when the endpoint
  // is not deployed yet, so the caller can degrade the control gracefully.
  async patchAgent(
    id: string,
    patch: {
      schedule?: string;
      enabled?: boolean;
      params?: Record<string, unknown>;
    }
  ): Promise<Agent> {
    return json<Agent>(`${workspaceBase()}/agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  async runAgent(id: string): Promise<{ runId: string }> {
    return json<{ runId: string }>(
      `${workspaceBase()}/agents/${encodeURIComponent(id)}/run`,
      { method: "POST" }
    );
  },

  async runs(agentId: string): Promise<AgentRun[]> {
    if (MOCK) return [];
    return json<AgentRun[]>(
      `${workspaceBase()}/runs?agent=${encodeURIComponent(agentId)}`
    );
  },

  async run(runId: string): Promise<AgentRun> {
    return json<AgentRun>(
      `${workspaceBase()}/runs/${encodeURIComponent(runId)}`
    );
  },

  async stage(): Promise<StageItem[]> {
    if (MOCK) return [];
    return json<StageItem[]>(`${workspaceBase()}/stage`);
  },

  // Live agents overview (SPEC-GATHER2 §2). Returns null on 404 / error so the
  // strip can degrade to "no agents" while the endpoint is still shipping.
  async gatherOverview(): Promise<GatherOverview | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/gather/overview`);
      if (!res.ok) return null;
      return (await res.json()) as GatherOverview;
    } catch {
      return null;
    }
  },

  async stageDecision(
    file: string,
    decision: "accept" | "reject",
    note?: string
  ): Promise<{ ok: boolean }> {
    return json<{ ok: boolean }>(`${workspaceBase()}/stage/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file, decision, ...(note ? { note } : {}) }),
    });
  },

  // ---- workspaces (global) ----------------------------------------------
  async workspaces(): Promise<WorkspaceInfo[] | null> {
    if (MOCK) return [{ id: "mock", name: "Mock", default: true }];
    try {
      const res = await fetch(`/api/workspaces`);
      if (!res.ok) return null;
      return (await res.json()) as WorkspaceInfo[];
    } catch {
      return null;
    }
  },

  // Networks (separate graphs) inside the active workspace. Older servers
  // have no such endpoint — null means "assume a single, default network".
  async networks(): Promise<NetworkInfo[] | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`${workspaceBase()}/networks`);
      if (!res.ok) return null;
      const list = (await res.json()) as NetworkInfo[];
      if (!Array.isArray(list)) return null;
      // Keep the UI default at the front without changing the server's
      // operational `default` network semantics.
      return list
        .map((network, order) => ({ network, order }))
        .sort(
          (left, right) =>
            Number(Boolean(right.network.ui_default)) -
              Number(Boolean(left.network.ui_default)) ||
            left.order - right.order
        )
        .map(({ network }) => network);
    } catch {
      return null;
    }
  },

  // ---- profile (global) --------------------------------------------------
  // Returns null when the endpoint is not deployed yet (graceful fallback).
  async profile(): Promise<Profile | null> {
    if (MOCK) return null;
    try {
      const res = await fetch(`/api/profile`);
      if (!res.ok) return null;
      return (await res.json()) as Profile;
    } catch {
      return null;
    }
  },

  async patchProfile(patch: {
    name?: string;
    mail?: string;
    phone?: string;
  }): Promise<Profile> {
    return json<Profile>(`/api/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },

  // Resolves on success; throws Error(message) with a friendly reason on 4xx.
  async changePassword(current: string, next: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/profile/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    if (res.status === 401) throw new Error("Current password is incorrect");
    if (res.status === 400) throw new Error("New password is too short");
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
    return (await res.json()) as { ok: boolean };
  },
};
