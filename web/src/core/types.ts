export type EntityType =
  | "person"
  | "company"
  | "institution"
  | "school"
  | "channel";

export type Status =
  | "aday"
  | "arastirildi"
  | "taslak"
  | "onay-bekliyor"
  | "gonderildi"
  | "cevap"
  | "randevu"
  | "red"
  | "pas";

export interface GraphNode {
  id: string;
  name: string;
  type: EntityType;
  subtype?: string | null;
  status?: Status | null;
  score?: number | null;
  degree: number;
  // enriched client-side from the entity list — optional
  city?: string | null;
  mail?: string | null;
  role?: string | null;
  mailSource?: string | null;
  closeness?: number | null;
  hook?: string | null;
  mail_count?: number;
  last_mail_date?: string | null;
  last_mail_direction?: "out" | "in" | null;
  last_mail_from?: string | null;
  hub?: boolean; // marked at render time
  // force-graph mutates these at runtime
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string | null;
  kind: "relation" | "mention";
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface EntityListItem {
  id: string;
  name: string;
  type: EntityType;
  subtype?: string | null;
  status?: Status | null;
  score?: number | null;
  city?: string | null;
  mail?: string | null;
  degree: number;
  mail_count?: number;
  last_mail_date?: string | null;
  last_mail_direction?: "out" | "in" | null;
  last_mail_from?: string | null;
  // enriched client-side / server-optional (used by list presets)
  role?: string | null;
  closeness?: number | null;
  hook?: string | null;
  mail_source?: string | null;
  connected_org?: string | null;
  connected_org_id?: string | null;
}

export interface Relation {
  id: string;
  name: string;
  type: EntityType;
  label?: string | null;
  kind: "relation" | "mention";
  direction: "out" | "in";
}

export interface EntityMeta {
  type?: EntityType;
  name?: string;
  subtype?: string | null;
  status?: Status | null;
  score?: number | null;
  city?: string | null;
  district?: string | null;
  mail?: string | null;
  mail_source?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  site?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  hook?: string | null;
  source_url?: string | null;
  found_date?: string | null;
  tags?: string[] | null;
  closeness?: number | null;
  role?: string | null;
  alumni_school?: string | null;
  alumni_year?: string | null;
  alumni_dept?: string | null;
  [key: string]: unknown;
}

export interface Entity {
  id: string;
  meta: EntityMeta;
  body: string;
  relations: Relation[];
  unresolved: string[];
}

// ---- facets (server /api/facets, or derived client-side) ----------------
export interface Facets {
  subtypes: Partial<Record<EntityType, Record<string, number>>>;
  statuses: Record<string, number>;
  cities: Record<string, number>;
  mail_sources: Record<string, number>;
  degree: { max: number; p99: number };
}

// ---- mails (server /api/ws/:ws/mails) -----------------------------------
export interface MailItem {
  id: string;
  entity_id: string;
  entity_name: string | null;
  person_id?: string;
  person_name?: string | null;
  direction: "out" | "in";
  date: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  summary: string;
  source: "import" | "vault" | "manual";
  raw?: string;
}

// ---- mail queue summary (server GET /api/ws/:ws/mailqueue) --------------
// Only the counts are consumed by the pipeline band; queue/awaitingScan
// arrays are omitted here since the band never reads the rows.
export interface MailQueueSummary {
  counts: { queue: number; awaitingScan: number };
}

export interface ReachStats {
  sent: number;
  replied: number;
  replyRate: number;
  pendingFollowUp: number;
}

// ---- mail drafts awaiting approval (SPEC-MAILPIPE "Draft onay API kontratı")
export interface MailDraftVariant {
  subject: string;
  body: string;
  rationale: string;
  tone: string;
}

export interface MailDraft {
  id: string;
  person: { id: string; name: string };
  company: { id: string; name: string };
  score: number;
  reasons: string[];
  variants: MailDraftVariant[];
  created_at: string;
  followup_stage: 0 | 1 | 2;
  status: "pending";
}

// Structured reason attached to a draft rejection so the system can learn
// (exclude a company, close a person, etc.). All optional — an empty reject
// is still a plain reject.
export type MailRejectKind =
  | "exclude-company"
  | "know-person"
  | "wrong-person"
  | "bad-content"
  | "other";

export interface MailRejectPayload {
  kind?: MailRejectKind;
  text?: string;
}

// Server may cascade a rejection (exclude a company => reject its other pending
// drafts). `rejected` lists every draft id that was removed. company_excluded /
// person_closed are present only when that side effect happened. Old servers
// may omit these fields entirely — the client falls back to the single id.
export interface MailRejectResult {
  rejected: string[];
  company_excluded?: { id: string; name: string };
  person_closed?: { id: string; name: string };
}

// ---- outreach exclusions (server GET /api/ws/:ws/exclusions) ------------
// A company removed from outreach via an `exclude-company` feedback. The owner
// can override (re-include) it via DELETE /exclusions/:companyId.
export interface Exclusion {
  company_id: string;
  name: string;
  by: string; // who excluded it
  at: string; // ISO timestamp
  reason: string;
}

// ---- overview metrics (server GET /api/ws/:ws/metrics) ------------------
export interface MetricsDailyPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface Metrics {
  totals: {
    entities: number;
    byType: Partial<Record<EntityType, number>>;
    withMail: number;
    withoutMail: number;
  };
  outreach: {
    mailsSent: number;
    uniqueRecipients: number;
    firstMailAt: string | null;
    lastMailAt: string | null;
    activeDays: number;
    avgPerActiveDay: number;
    daily: MetricsDailyPoint[]; // last 30 days, empty days = 0
    byStatus?: Record<string, number>;
  };
  gather: {
    staged: number;
    acceptedTotal: number;
    agents: number;
    running: number;
  };
  reach: {
    candidates: number;
  };
}

// ---- gather: agents / runs / stage --------------------------------------
export interface RunSummary {
  id: string;
  started: string | null;
  ended: string | null;
  status: "ok" | "error" | "running" | string;
  items_in: number;
  items_out: number;
  staged: number;
  warnings: number;
  note?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  zone: "gathering" | "network" | string;
  model: string;
  task: string;
  integration: string;
  params: Record<string, unknown>;
  schedule: string;
  enabled: boolean;
  last_run: RunSummary | null;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  started: string | null;
  ended: string | null;
  status: "ok" | "error" | "running" | string;
  items_in: number;
  items_out: number;
  staged: number;
  warnings: string[];
  log_tail: string;
  note?: string | null;
}

// gather taxonomy (SPEC-GATHER2 §1)
export type GatherKind = "discover-company" | "discover-person" | "enrich";
export type GatherSource = "company" | "standalone";

export interface StageItem {
  file: string;
  entity_hint: string;
  summary: string;
  fields: Record<string, string>;
  // propagated from the producing agent; older records omit it → treat as enrich
  kind?: GatherKind;
}

// ---- gather overview (server GET /api/ws/:ws/gather/overview) ------------
export interface OverviewAgent {
  id: string;
  name: string;
  kind: GatherKind;
  source?: GatherSource | null;
  enabled: boolean;
  status: "running" | "idle" | "error" | string;
  currentTask: string | null;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  stagedCount: number;
}

export interface GatherOverview {
  agents: OverviewAgent[];
  counts: Record<GatherKind, { staged: number; accepted: number }>;
}

// ---- profile (global /api/profile) --------------------------------------
export interface Profile {
  username: string;
  name: string;
  mail: string;
  phone: string;
  role: string;
}

// ---- workspaces (global /api/workspaces) --------------------------------
export interface WorkspaceInfo {
  id: string;
  name: string;
  entities?: number;
  default?: boolean;
  active?: boolean;
  comingSoon?: boolean;
}
