// Personal dashboard layout — server GET/PUT /api/ws/:ws/dashboard. Each user
// has their own section order + visibility; the assistant agent may rewrite it.
// The UI only reads it here (the agent writes via the server). On any failure we
// fall back to the default order so the page never breaks.
import { workspaceBase } from "./api";

const MOCK = import.meta.env.VITE_MOCK === "1";

export type SectionId =
  | "prompt"
  | "kpis"
  | "maildrafts"
  | "mailchart"
  | "types"
  | "activity";

export interface DashboardSection {
  id: SectionId;
  visible: boolean;
}

export interface DashboardLayout {
  sections: DashboardSection[];
  notes: Record<string, string>;
}

// The prompt bar is always pinned to the top and can never be hidden, so it is
// not part of the reorderable body list.
export const BODY_SECTIONS: SectionId[] = [
  "kpis",
  "maildrafts",
  "mailchart",
  "types",
  "activity",
];

const KNOWN: ReadonlySet<string> = new Set<SectionId>([
  "prompt",
  ...BODY_SECTIONS,
]);

// Card-style sections that read best grouped side-by-side in a grid run.
export const CARD_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  "mailchart",
  "types",
  "activity",
]);

export function defaultLayout(): DashboardLayout {
  return {
    sections: BODY_SECTIONS.map((id) => ({ id, visible: true })),
    notes: {},
  };
}

// Resolve a (possibly partial or absent) layout into the ordered list of body
// sections to render. Honors explicit order + visibility; any known section the
// layout omits is appended (visible) so a partial layout still shows everything.
export function resolveBodyOrder(
  layout: DashboardLayout | null
): SectionId[] {
  if (!layout || !Array.isArray(layout.sections)) return [...BODY_SECTIONS];
  const order: SectionId[] = [];
  const seen = new Set<SectionId>();
  for (const s of layout.sections) {
    if (!s || !KNOWN.has(s.id) || s.id === "prompt") continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.visible === false) continue;
    order.push(s.id);
  }
  for (const id of BODY_SECTIONS) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

// GET the current user's layout. Returns null on 404 / error (endpoint absent
// or offline) so the caller uses the default order.
export async function fetchDashboard(): Promise<DashboardLayout | null> {
  if (MOCK) return null;
  try {
    const res = await fetch(`${workspaceBase()}/dashboard`);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<DashboardLayout>;
    return {
      sections: Array.isArray(body.sections) ? body.sections : [],
      notes: body.notes && typeof body.notes === "object" ? body.notes : {},
    };
  } catch {
    return null;
  }
}
