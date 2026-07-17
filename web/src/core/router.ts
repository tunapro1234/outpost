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
  | "mail"
  | "agents"
  | "workspace"
  | "integrations"
  | "profile";

export type Route =
  // `sub` carries an in-view sub-route (e.g. the Mail Calibration studio at
  // /mail/calibration) so the shell can render a full-page sub-view without a
  // separate top-level route.
  | { name: "view"; key: ViewKey; sub: string | null }
  | { name: "entity"; id: string };

const PATH_TO_VIEW: Record<string, ViewKey> = {
  "/": "overview",
  "/network": "network",
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
  overview: "/",
  network: "/network",
  mail: "/mail",
  agents: "/agents",
  workspace: "/workspace",
  integrations: "/integrations",
  profile: "/profile",
};

// Rewrite legacy URLs to their canonical paths on first load so bookmarks and
// shared links land on a working page. /gather → /agents, /reach* → /mail*.
if (typeof window !== "undefined") {
  const p = window.location.pathname;
  let rewritten: string | null = null;
  if (p === "/gather") rewritten = "/agents";
  else if (p === "/reach/calibration") rewritten = "/mail/calibration";
  else if (p === "/reach") rewritten = "/mail";
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

// The Mail Calibration studio lives at a stable deep-linkable sub-path.
export const MAIL_CALIBRATION_PATH = "/mail/calibration";

function parse(): Route {
  const path = window.location.pathname;
  const m = path.match(/^\/e\/(.+)$/);
  if (m) return { name: "entity", id: decodeURIComponent(m[1]) };
  if (path === "/mail/calibration")
    return { name: "view", key: "mail", sub: "calibration" };
  const key = PATH_TO_VIEW[path] ?? "overview";
  return { name: "view", key, sub: null };
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === "entity" && b.name === "entity") return a.id === b.id;
  if (a.name === "view" && b.name === "view")
    return a.key === b.key && a.sub === b.sub;
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
