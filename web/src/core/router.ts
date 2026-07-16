import { useSyncExternalStore } from "react";

// ---- lightweight path router --------------------------------------------
// Only two routes matter: the app shell ("home") and the full entity page
// (`/e/:id`). The server + vite both fall back to index.html for unknown
// paths, so deep links and refresh work without extra config. The legacy
// `?select=` / `?f=` query params keep working on the home route untouched.

export type Route = { name: "home" } | { name: "entity"; id: string };

function parse(): Route {
  const m = window.location.pathname.match(/^\/e\/(.+)$/);
  if (m) return { name: "entity", id: decodeURIComponent(m[1]) };
  return { name: "home" };
}

let current: Route = parse();
const listeners = new Set<() => void>();

function refresh(): void {
  const next = parse();
  // keep reference stable when the route is unchanged (useSyncExternalStore)
  if (next.name === current.name && (next as { id?: string }).id === (current as { id?: string }).id) {
    return;
  }
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
