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
  // force-graph mutates these at runtime
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
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

export interface Stats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  edgeCount: number;
}

export interface GraphFilters {
  types: EntityType[];
  statuses: Status[];
  minScore: number | null;
  q: string;
}
