import { useSyncExternalStore } from "react";

// ---- lightweight path router --------------------------------------------
// Three shapes matter: the top-level views (Overview "/", Network "/network",
// and the other modules on their own paths), and the full entity page
// (`/e/:id`). The server + vite both fall back to index.html for unknown
// paths, so deep links and refresh work without extra config. The legacy
// `?select=` / `?f=` query params keep working untouched.

export type ViewKey =
  | "overview"
  | "network"
  | "reach"
  | "gather"
  | "integrations"
  | "profile";

export type Route =
  | { name: "view"; key: ViewKey }
  | { name: "entity"; id: string };

const PATH_TO_VIEW: Record<string, ViewKey> = {
  "/": "overview",
  "/network": "network",
  "/reach": "reach",
  "/gather": "gather",
  "/integrations": "integrations",
  "/profile": "profile",
};

const VIEW_TO_PATH: Record<ViewKey, string> = {
  overview: "/",
  network: "/network",
  reach: "/reach",
  gather: "/gather",
  integrations: "/integrations",
  profile: "/profile",
};

export function viewPath(key: ViewKey): string {
  return VIEW_TO_PATH[key];
}

function parse(): Route {
  const m = window.location.pathname.match(/^\/e\/(.+)$/);
  if (m) return { name: "entity", id: decodeURIComponent(m[1]) };
  const key = PATH_TO_VIEW[window.location.pathname] ?? "overview";
  return { name: "view", key };
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "entity" && b.name === "entity") return a.id === b.id;
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

export function entityPath(id: string): string {
  return `/e/${encodeURIComponent(id)}`;
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
