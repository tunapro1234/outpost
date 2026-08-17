import { useSyncExternalStore } from "react";

// ---- lightweight path router --------------------------------------------
// Three shapes matter: the top-level views (Overview "/", Network "/network",
// and the other modules on their own paths), and the full entity page
// (`/e/:id`). The server + vite both fall back to index.html for unknown
// paths, so deep links and refresh work without extra config. The legacy
// `?select=` / `?f=` query params keep working untouched.

export type ViewKey =
  | "today"
  | "overview"
  | "network"
  | "schools"
  | "institutions"
  | "teams"
  | "teachers"
  | "competitors"
  | "ftc2027"
  | "mail"
  | "agents"
  | "workspace"
  | "integrations"
  | "profile";

export type Route =
  | { name: "view"; key: ViewKey }
  | { name: "entity"; id: string; network?: string };

const PATH_TO_VIEW: Record<string, ViewKey> = {
  "/": "overview",
  "/today": "today",
  "/overview": "overview",
  "/network": "network",
  "/lists/schools": "schools",
  "/lists/institutions": "institutions",
  "/lists/teams": "teams",
  "/lists/teachers": "teachers",
  "/lists/competitors": "competitors",
  "/lists/2027-ftc": "ftc2027",
  "/mail": "mail",
  // legacy alias — the module used to be called Reach. Kept so old links and
  // bookmarks still resolve; navigate() below rewrites the URL to /mail.
  "/reach": "mail",
  "/agents": "agents",
  // legacy alias — the module used to live at /gather. Kept so old links and
  // bookmarks still resolve; navigate() below rewrites the URL to /agents.
  "/gather": "agents",
  "/workspace": "workspace",
  "/integrations": "integrations",
  "/profile": "profile",
};

const VIEW_TO_PATH: Record<ViewKey, string> = {
  today: "/today",
  overview: "/overview",
  network: "/network",
  schools: "/lists/schools",
  institutions: "/lists/institutions",
  teams: "/lists/teams",
  teachers: "/lists/teachers",
  competitors: "/lists/competitors",
  ftc2027: "/lists/2027-ftc",
  mail: "/mail",
  agents: "/agents",
  workspace: "/workspace",
  integrations: "/integrations",
  profile: "/profile",
};

// Rewrite legacy URLs to their canonical paths on first load so bookmarks and
// shared links land on a working page instead of a 404-ish fallback:
// /gather* → /agents, /reach* → /mail, and any retired /mail sub-page → /mail.
if (typeof window !== "undefined") {
  const p = window.location.pathname;
  let rewritten: string | null = null;
  if (p === "/gather" || p.startsWith("/gather/")) rewritten = "/agents";
  else if (p === "/reach" || p.startsWith("/reach/")) rewritten = "/mail";
  else if (p.startsWith("/mail/")) rewritten = "/mail";
  if (rewritten) {
    window.history.replaceState(
      null,
      "",
      rewritten + window.location.search + window.location.hash
    );
  }
}

export function viewPath(key: ViewKey): string {
  return VIEW_TO_PATH[key];
}

function parse(): Route {
  const path = window.location.pathname;
  const m = path.match(/^\/e\/(.+)$/);
  if (m) {
    const network = new URLSearchParams(window.location.search).get("net")?.trim();
    return {
      name: "entity",
      id: decodeURIComponent(m[1]),
      ...(network ? { network } : {}),
    };
  }
  const key = PATH_TO_VIEW[path] ?? "overview";
  return { name: "view", key };
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "entity" && b.name === "entity") {
    return a.id === b.id && a.network === b.network;
  }
  if (a.name === "view" && b.name === "view") return a.key === b.key;
  return true;
}

let current: Route = parse();
const listeners = new Set<() => void>();

function refresh(): void {
  const next = parse();
  // keep reference stable when the route is unchanged (useSyncExternalStore)
  if (sameRoute(next, current)) return;
  current = next;
  for (const l of listeners) l();
}

window.addEventListener("popstate", refresh);

export function navigate(path: string, opts?: { replace?: boolean }): void {
  const url = new URL(path, window.location.origin);
  if (opts?.replace) window.history.replaceState(null, "", url.toString());
  else window.history.pushState(null, "", url.toString());
  refresh();
}

export function entityPath(id: string, network?: string | null): string {
  const path = `/e/${encodeURIComponent(id)}`;
  return network ? `${path}?net=${encodeURIComponent(network)}` : path;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
